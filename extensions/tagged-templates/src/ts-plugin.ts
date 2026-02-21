/**
 * TypeScript Server Plugin for Thane tagged templates.
 *
 * Intercepts getCompletionsAtPosition and filters out auto-import suggestions
 * when the cursor is inside a ${ } expression within an html`` or css``
 * tagged template literal. This keeps only:
 *
 *   - Locally declared variables, functions, classes
 *   - Imported symbols
 *   - Function parameters (closure scope)
 *   - TypeScript keywords (true, false, null, typeof, etc.)
 *
 * Without this plugin, TypeScript suggests thousands of globals from
 * lib.dom.d.ts, lib.es*.d.ts, and auto-imports from node_modules —
 * flooding the dropdown inside template expressions.
 */

function init(modules: { typescript: typeof import('typescript') }) {
  const ts = modules.typescript;

  function create(info: ts.server.PluginCreateInfo) {
    const log = (msg: string) => info.project.projectService.logger.info(`[thane-ts-plugin] ${msg}`);
    log('Plugin loaded successfully');

    const ls = info.languageService;

    // Create a proxy that delegates everything to the real language service
    const proxy: ts.LanguageService = Object.create(null);
    for (const k of Object.keys(ls) as Array<keyof ts.LanguageService>) {
      const x = ls[k];
      // @ts-expect-error — proxy delegation
      proxy[k] = typeof x === 'function' ? (...args: any[]) => (x as Function).apply(ls, args) : x;
    }

    proxy.getCompletionsAtPosition = (
      fileName: string,
      position: number,
      options: ts.GetCompletionsAtPositionOptions | undefined,
      formattingSettings?: ts.FormatCodeSettings,
    ) => {
      log(`getCompletionsAtPosition called: ${fileName}:${position}`);
      const original = ls.getCompletionsAtPosition(fileName, position, options, formattingSettings);
      if (!original) return original;

      try {
        const program = ls.getProgram();
        if (!program) { log('No program'); return original; }

        const sourceFile = program.getSourceFile(fileName);
        if (!sourceFile) { log('No source file'); return original; }

        const inside = isInsideTaggedTemplateExpression(sourceFile, position);
        log(`isInsideTaggedTemplate: ${inside}, entries: ${original.entries.length}`);
        if (!inside) {
          return original;
        }

        // Filter: remove auto-import suggestions, keep local scope + keywords
        const filtered = original.entries.filter((entry) => {
          // Always keep TS keywords (true, false, null, typeof, new, etc.)
          if (entry.kind === ts.ScriptElementKind.keyword) return true;

          // Remove auto-import suggestions (the bulk of the noise)
          if (entry.hasAction) return false;
          if (entry.source) return false;

          // Remove well-known global types/interfaces that clutter templates
          // (DOM types, lib.es types that aren't useful in template expressions)
          if (entry.kind === ts.ScriptElementKind.interfaceElement || entry.kind === ts.ScriptElementKind.typeElement) {
            return false;
          }

          // Keep everything else:
          // - local variables, parameters, function-scoped declarations
          // - imported symbols
          // - functions, classes declared in file
          return true;
        });

        log(`Filtered: ${original.entries.length} -> ${filtered.length}`);
        return { ...original, entries: filtered };
      } catch (e) {
        log(`Error: ${e}`);
        // On any error, fall back to unfiltered completions
        return original;
      }
    };

    /**
     * Checks whether `position` is inside a ${...} expression
     * of an html`` or css`` tagged template literal.
     */
    function isInsideTaggedTemplateExpression(sourceFile: ts.SourceFile, position: number): boolean {
      let found = false;

      function visit(node: ts.Node): void {
        if (found) return;

        // Skip nodes that don't contain the position
        const start = node.getStart(sourceFile);
        const end = node.getEnd();
        if (position < start || position > end) return;

        // Check if this is a tagged template with html/css tag
        if (ts.isTaggedTemplateExpression(node)) {
          const tag = node.tag;
          const tagName = ts.isIdentifier(tag) ? tag.text : '';
          log(`Found tagged template: tag=${tagName}, range=${start}-${end}`);

          if (tagName === 'html' || tagName === 'css') {
            const template = node.template;

            if (ts.isTemplateExpression(template)) {
              for (const span of template.templateSpans) {
                const expr = span.expression;
                const exprStart = expr.getStart(sourceFile);
                const exprEnd = expr.getEnd();

                if (position >= exprStart && position <= exprEnd) {
                  found = true;
                  return;
                }
              }
            }
          }
        }

        // Recurse into children (handles nested templates)
        ts.forEachChild(node, visit);
      }

      visit(sourceFile);
      return found;
    }

    return proxy;
  }

  return { create };
}

export = init;
