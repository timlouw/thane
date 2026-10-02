import fs from 'node:fs';
import type { OnLoadArgs, OnLoadResult, Plugin } from 'esbuild';
import ts from 'typescript';
import type { BuildContext } from '../../types.js';
import {
  sourceCache,
  logger,
  PLUGIN_NAME,
  FN,
  createLoaderResult,
  extendsComponentQuick,
  createBuildContext,
  refreshBuildContext,
  applyEdits,
  findComponentDeclarations,
} from '../../utils/index.js';
import { createComponentResolver, type ComponentResolver } from '../../utils/component-resolver.js';
import { transformDefineComponentSource } from '../reactive-binding-compiler/index.js';
import type { CompileOptions } from '../reactive-binding-compiler/index.js';
import type { TemplateNames } from '../reactive-binding-compiler/types.js';
import {
  compileCssTemplate,
  declaresOwnCssTag,
  isCssTaggedTemplate,
  KEYFRAME_SCOPING,
} from '../minification/css-transform.js';
import { ErrorCode, createError, createWarning, withConfiguredSeverity } from '../../errors.js';
import { hotModuleKey, hotRegistration, keepModuleSignals, recordHotModule, trackHotInput } from './hot-modules.js';
import { createModuleResolver, type ModuleResolver } from '../../utils/module-graph.js';
import { INTERNAL_RUNTIME_SPECIFIER, RUNTIME_HELPER } from '../../../contracts/index.js';

const NAME = PLUGIN_NAME.COMPONENT;

/** A module that exports a fragment, `export const Name = html\`…\``, is compiled even without a component */
const EXPORTED_FRAGMENT = /\bexport\s+const\s+[\w$]+\s*=\s*html`/;

/**
 * @param ctx - the build's shared context
 * @param mode - `hotUpdate` for the build of one changed file that `thane dev` sends to the page
 */
export const ComponentPrecompilerPlugin = (ctx?: BuildContext, mode: { hotUpdate?: boolean } = {}): Plugin => ({
  name: NAME,
  setup(build) {
    // Which components each file can call; made anew for every build, so it sees the current sources
    let resolver: ComponentResolver | null = null;

    // Read per file: a production build plans its selector renames in onStart, before any load
    const compileOptions = (): CompileOptions => ({ minify: ctx?.minify, selectorMap: ctx?.selectorMap });
    let scanned = false;

    // The component that declares each selector in this build. Two components with one selector share
    // their host class, and the styles of the one registered first apply to both (THANE013).
    let selectorOwners = new Map<string, { name: string; file: string }>();
    const reportSharedSelectors = (sourceFile: ts.SourceFile, file: string): void => {
      for (const { name, selector, call } of findComponentDeclarations(sourceFile)) {
        const owner = selectorOwners.get(selector);
        if (!owner) selectorOwners.set(selector, { name, file });
        if (!owner || (owner.name === name && owner.file === file)) continue;
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
        const diagnostic = withConfiguredSeverity(
          createWarning(
            `${name} has the selector '${selector}', and so does ${owner.name} (${owner.file}). The two share ` +
              'their host class, and the styles of the one registered first apply to both. Give one of them ' +
              'another name or an explicit selector.',
            { file, line: line + 1, column: character + 1 },
            ErrorCode.SHARED_SELECTOR,
          ),
          ctx?.lint,
        );
        if (diagnostic) logger.diagnostic(diagnostic);
      }
    };

    // `thane dev`: each build resolves the modules' imports afresh, so that a file added meanwhile is found
    let resolveImport: ModuleResolver | undefined;
    build.onStart(async () => {
      selectorOwners = new Map();
      if (!mode.hotUpdate) ctx?.hot?.changed.clear();
      if (ctx?.hot && !mode.hotUpdate) resolveImport = createModuleResolver(ctx.projectRoot);
      // A rebuild in watch mode scans again, so that a component file added meanwhile is found
      if (ctx && scanned) await refreshBuildContext(ctx);
      scanned = true;
      const buildContext = ctx ?? (await createBuildContext());
      resolver = createComponentResolver(buildContext.projectRoot, buildContext.components);
      if (buildContext.components.length > 0 && !mode.hotUpdate) {
        logger.info(NAME, `Found ${buildContext.components.length} component(s)`);
      }
    });

    // ── Mount-call optimiser (a component → mountComponent) ────────────────
    // Rewrites `import { mount } from 'thane'` + `mount(X)` or `mount(X, { target?: T, props?: P })`, where X
    // is a component the file can name, into `import { mountComponent } from 'thane/runtime'` +
    // `mountComponent(X, T, P)`, so the generic mount() wrapper, _routerMount hook, and __setRouterMount
    // are all tree-shaken away for apps without routes.
    const rewriteMountToMountComponent = (
      source: string,
      sf: ts.SourceFile,
      components: ReadonlyMap<string, unknown>,
    ): string | null => {
      // 1. Only thane's `mount`, imported under its own name, and only when it is called once: the
      //    rewrite takes `mount` out of the import, so a second call, or a local function of that
      //    name, would be left without a definition
      const mountImport = sf.statements.find(
        (s): s is ts.ImportDeclaration =>
          ts.isImportDeclaration(s) &&
          ts.isStringLiteral(s.moduleSpecifier) &&
          s.moduleSpecifier.text === 'thane' &&
          !s.importClause?.phaseModifier &&
          !s.importClause?.name &&
          !!s.importClause?.namedBindings &&
          ts.isNamedImports(s.importClause.namedBindings) &&
          s.importClause.namedBindings.elements.some(
            (e) => !e.isTypeOnly && !e.propertyName && e.name.text === 'mount',
          ),
      );
      const mountCalls: ts.CallExpression[] = [];
      // Any other reference (`const m = mount`, `export { mount }`) still needs the import
      let otherReferences = 0;
      const findMount = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'mount') {
          mountCalls.push(node);
          node.arguments.forEach(findMount);
          return;
        }
        if (ts.isIdentifier(node) && node.text === 'mount' && !ts.isImportSpecifier(node.parent)) {
          const parent = node.parent;
          const isPropertyName =
            (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
            (ts.isPropertyAssignment(parent) && parent.name === node);
          if (!isPropertyName) otherReferences++;
        }
        ts.forEachChild(node, findMount);
      };
      findMount(sf);

      const mc = mountCalls[0];
      const [componentArg, optionsArg, ...extra] = mc?.arguments ?? [];
      if (
        !mountImport ||
        mountCalls.length !== 1 ||
        otherReferences > 0 ||
        !mc ||
        extra.length > 0 ||
        !componentArg ||
        !ts.isIdentifier(componentArg) ||
        // Routes, or anything else that is not a component of the file, go through mount()
        !components.has(componentArg.text) ||
        (optionsArg && !ts.isObjectLiteralExpression(optionsArg))
      ) {
        return null;
      }

      // 2. The target and props of the options (any other option, such as routes, keeps mount())
      const componentText = componentArg.text;
      let targetText: string | null = null;
      let propsText: string | null = null;
      for (const prop of optionsArg && ts.isObjectLiteralExpression(optionsArg) ? optionsArg.properties : []) {
        const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : undefined;
        const valueText = ts.isPropertyAssignment(prop)
          ? prop.initializer.getText(sf)
          : ts.isShorthandPropertyAssignment(prop)
            ? prop.name.text
            : undefined;
        if (name === 'target' && valueText) targetText = valueText;
        else if (name === 'props' && valueText) propsText = valueText;
        else return null;
      }

      // 3. Build the mountComponent(...) call arguments
      const args: string[] = [componentText];
      if (targetText || propsText) {
        args.push(targetText ?? 'document.body');
      }
      if (propsText) {
        args.push(propsText);
      }

      // 4. Replace the mount call, and fix the import: `mount` leaves it, and mountComponent comes
      //    from the compiler's entry, with the other helpers compiled code calls
      const rest = (mountImport.importClause!.namedBindings as ts.NamedImports).elements
        .map((e) => e.getText(sf))
        .filter((s) => s !== 'mount');
      const runtimeImport = `import { ${RUNTIME_HELPER.MOUNT_COMPONENT} } from '${INTERNAL_RUNTIME_SPECIFIER}'`;
      return applyEdits(source, [
        {
          start: mountImport.getStart(sf),
          end: mountImport.moduleSpecifier.getEnd(),
          replacement:
            rest.length > 0 ? `import { ${rest.join(', ')} } from 'thane';\n${runtimeImport}` : runtimeImport,
        },
        {
          start: mc.getStart(sf),
          end: mc.getEnd(),
          replacement: `${RUNTIME_HELPER.MOUNT_COMPONENT}(${args.join(', ')})`,
        },
      ]);
    };

    /**
     * Replace tagged templates with plain ones using the AST: html`...` loses its tag, and
     * css`...` is compiled (its tag goes, and a production build minifies the stylesheet).
     * `parsed` is the code's parse, when there is one.
     */
    const stripTemplateTags = (
      code: string,
      filePath: string,
      options: CompileOptions,
      parsed?: ts.SourceFile,
    ): string => {
      const sf = parsed ?? ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true);
      // Collect positions to strip in reverse order (end → start)
      const edits: { start: number; end: number; replacement: string }[] = [];
      const ownCssTag = declaresOwnCssTag(sf);
      const walk = (node: ts.Node) => {
        if (!ownCssTag && isCssTaggedTemplate(node)) {
          edits.push({
            start: node.getStart(sf),
            end: node.getEnd(),
            replacement: compileCssTemplate(node, sf, options),
          });
          return; // nested css templates are compiled along with this one
        }
        if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === 'html') {
          // Remove the tag identifier — keep only the template literal
          edits.push({ start: node.tag.getStart(sf), end: node.template.getStart(sf), replacement: '' });
        }
        ts.forEachChild(node, walk);
      };
      walk(sf);
      // Apply in reverse to preserve positions
      let result = code;
      for (let i = edits.length - 1; i >= 0; i--) {
        const edit = edits[i]!;
        result = result.substring(0, edit.start) + edit.replacement + result.substring(edit.end);
      }
      return result;
    };

    /**
     * Apply reactive binding transformation, strip template tags, and produce loader result. `names` are the
     * components the file can call and the fragments it imports, which the binding compiler mounts where its
     * templates use them; `parsed` is the file's one parse.
     */
    const buildTransformedResult = (
      source: string,
      filePath: string,
      names: TemplateNames,
      parsed: ts.SourceFile,
    ): { contents: string; loader: 'ts' } => {
      let keyframes = false;
      const options = {
        ...compileOptions(),
        onKeyframes: () => (keyframes = true),
        // `thane dev`: the components' signals keep their values through hot updates
        hotModule: ctx?.hot ? hotModuleKey(filePath, ctx.projectRoot) : undefined,
      };
      // The binding compiler strips the templates' tags along with its other edits
      const transformed =
        extendsComponentQuick(source) || EXPORTED_FRAGMENT.test(source)
          ? transformDefineComponentSource(source, filePath, names, options, parsed)
          : null;
      // Binding code that repeats a template expression as written (a when() used as text) can hold a
      // tag of its own, which only a parse of the compiled code finds
      const result =
        transformed === null
          ? stripTemplateTags(source, filePath, options, parsed)
          : transformed.includes(FN.HTML + '`')
            ? stripTemplateTags(transformed, filePath, options)
            : transformed;
      return createLoaderResult(keyframes ? result + '\n' + KEYFRAME_SCOPING : result);
    };

    /** css`` templates compiled, and keyframe scoping added when one of them defines keyframes */
    const compileCssOnly = (code: string, filePath: string, parsed?: ts.SourceFile): string => {
      let keyframes = false;
      const options = { ...compileOptions(), onKeyframes: () => (keyframes = true) };
      const result = stripTemplateTags(code, filePath, options, parsed);
      return keyframes ? result + '\n' + KEYFRAME_SCOPING : result;
    };

    const load = async (args: OnLoadArgs): Promise<OnLoadResult | undefined> => {
      try {
        if (args.path.includes('node_modules')) {
          return undefined;
        }

        // The file as read and parsed once for the build (the scan and the linter read the same)
        const cached = await sourceCache.get(args.path);
        const source = cached?.source ?? (await fs.promises.readFile(args.path, 'utf8'));
        const parse = (): ts.SourceFile => cached?.sourceFile ?? sourceCache.parse(args.path, source);

        // ── Mount-call optimiser ──
        // A component's mount, mount(X) → mountComponent(X), so the generic mount() wrapper + router hook
        // are tree-shaken away entirely.
        if (source.includes('mount(') && !source.includes(FN.HTML + '`')) {
          const sf = parse();
          const components = resolver ? await resolver.componentsInScope(sf) : new Map();
          const rewritten = rewriteMountToMountComponent(source, sf, components);
          if (rewritten) {
            logger.info(NAME, `Optimised mount() → mountComponent() in ${args.path}`);
            return createLoaderResult(source.includes(FN.CSS + '`') ? compileCssOnly(rewritten, args.path) : rewritten);
          }
        }

        if (!source.includes(FN.HTML + '`')) {
          // A module with only css`` templates (shared styles) still needs them compiled:
          // the tag is a compile-time marker and does not exist at runtime.
          if (source.includes(FN.CSS + '`')) {
            return createLoaderResult(compileCssOnly(source, args.path, parse()));
          }
          return undefined;
        }

        // The components this file declares or imports, and the fragments it imports: the binding compiler
        // mounts each where a template calls or uses it
        const sourceFile = parse();
        reportSharedSelectors(sourceFile, args.path);
        const components = resolver ? await resolver.componentsInScope(sourceFile) : new Map();
        const fragments = resolver ? await resolver.fragmentsInScope(sourceFile) : new Map();
        return buildTransformedResult(source, args.path, { components, fragments }, sourceFile);
      } catch (error) {
        const diagnostic = createError(
          `Error processing ${args.path}: ${error instanceof Error ? error.message : error}`,
          { file: args.path, line: 0, column: 0 },
          ErrorCode.PLUGIN_ERROR,
        );
        logger.diagnostic(diagnostic);
        // A component the compiler cannot process must fail the build rather than ship uncompiled
        return { errors: [{ text: diagnostic.message, location: { file: args.path } }] };
      }
    };

    build.onLoad({ filter: /\.ts$/ }, async (args) => {
      const result = await load(args);
      // `thane dev`: every project module registers itself in the page, for hot updates to import, and
      // the build records whether it changed, what it imports, and whether the page can swap it (see
      // hot-modules.ts). A module the compiler leaves as it is keeps its signals through hot updates, as a
      // component file does.
      const hot = ctx?.hot;
      if (!hot || args.path.includes('node_modules') || result?.errors) return result;
      const cached = await sourceCache.get(args.path);
      if (!cached) return result;
      const code =
        typeof result?.contents === 'string'
          ? result.contents
          : keepModuleSignals(cached.source, cached.sourceFile, hotModuleKey(args.path, ctx.projectRoot));
      if (mode.hotUpdate) return code === cached.source ? result : createLoaderResult(code);
      trackHotInput(hot, args.path, cached.source);
      if (resolveImport) recordHotModule(hot, args.path, cached.sourceFile, resolveImport);
      return createLoaderResult(hotRegistration(args.path, code, cached.sourceFile, ctx.projectRoot));
    });
  },
});
