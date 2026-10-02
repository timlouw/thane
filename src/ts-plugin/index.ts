/**
 * The Thane TypeScript plugin: template event handler types in the editor.
 *
 * The build's type check gives each `@event=${handler}` its event's type by rewriting the handler for the
 * checker only (compiler/plugins/tsc-type-checker/template-types.ts). An editor reads the source as
 * written, where the handler's parameter is `any`. This plugin keeps a second language service over the
 * rewritten sources and answers from it for a file with handlers: its semantic errors, and hover,
 * completions and signature help at a position inside a handler. Every position is mapped back to the
 * source as written. Everything else is the editor's own language service.
 *
 * Enable it in tsconfig.json: `"compilerOptions": { "plugins": [{ "name": "thane/ts-plugin" }] }`, and in
 * VS Code use the workspace's TypeScript version.
 */

import type * as ts from 'typescript';
import {
  TEMPLATE_TYPES_DECLARATION,
  rewriteTemplates,
  type RewrittenSource,
} from '../compiler/plugins/tsc-type-checker/template-types.js';

type Typescript = typeof ts;

const create = (typescript: Typescript, info: ts.server.PluginCreateInfo): ts.LanguageService => {
  const host = info.languageServiceHost;
  const service = info.languageService;
  const declarationFile = `${info.project.getCurrentDirectory().replace(/\\/g, '/')}/.thane/types/template-types.d.ts`;

  // One rewrite per file version
  const rewrites = new Map<string, { version: string; rewrite: RewrittenSource | null }>();
  const rewriteOf = (fileName: string): RewrittenSource | null => {
    if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts') || fileName.includes('/node_modules/')) return null;
    const version = host.getScriptVersion(fileName);
    const cached = rewrites.get(fileName);
    if (cached?.version === version) return cached.rewrite;
    const snapshot = host.getScriptSnapshot(fileName);
    const rewrite = snapshot ? rewriteTemplates(fileName, snapshot.getText(0, snapshot.getLength())) : null;
    rewrites.set(fileName, { version, rewrite });
    return rewrite;
  };

  // The second language service reads the rewritten sources, and the declaration of their handler type
  const shadowHost: ts.LanguageServiceHost = Object.create(host);
  shadowHost.getScriptFileNames = () => [...host.getScriptFileNames(), declarationFile];
  shadowHost.getScriptVersion = (fileName) => (fileName === declarationFile ? '1' : host.getScriptVersion(fileName));
  shadowHost.getScriptSnapshot = (fileName) => {
    if (fileName === declarationFile) return typescript.ScriptSnapshot.fromString(TEMPLATE_TYPES_DECLARATION);
    const rewrite = rewriteOf(fileName);
    return rewrite ? typescript.ScriptSnapshot.fromString(rewrite.text) : host.getScriptSnapshot(fileName);
  };
  shadowHost.fileExists = (fileName) => fileName === declarationFile || (host.fileExists?.(fileName) ?? false);
  const shadow = typescript.createLanguageService(shadowHost, typescript.createDocumentRegistry());

  const mapSpan = (rewrite: RewrittenSource, span: ts.TextSpan): ts.TextSpan =>
    rewrite.toOriginal(span.start, span.length);
  const mapDiagnostic = <T extends ts.Diagnostic | ts.DiagnosticRelatedInformation>(diagnostic: T): T => {
    const rewrite = diagnostic.file && rewriteOf(diagnostic.file.fileName);
    if (!rewrite || diagnostic.start === undefined) return diagnostic;
    const original = service.getProgram()?.getSourceFile(diagnostic.file!.fileName) ?? diagnostic.file;
    return { ...diagnostic, file: original, ...rewrite.toOriginal(diagnostic.start, diagnostic.length ?? 0) };
  };

  const proxy: ts.LanguageService = Object.create(null);
  for (const key of Object.keys(service) as Array<keyof ts.LanguageService>) {
    const method = service[key];
    (proxy as any)[key] =
      typeof method === 'function' ? (...args: unknown[]) => (method as Function).apply(service, args) : method;
  }

  proxy.getSemanticDiagnostics = (fileName) => {
    if (!rewriteOf(fileName)) return service.getSemanticDiagnostics(fileName);
    return shadow.getSemanticDiagnostics(fileName).map((diagnostic) => {
      const mapped = mapDiagnostic(diagnostic);
      return diagnostic.relatedInformation
        ? { ...mapped, relatedInformation: diagnostic.relatedInformation.map(mapDiagnostic) }
        : mapped;
    });
  };

  proxy.getQuickInfoAtPosition = (fileName, position, ...rest) => {
    const rewrite = rewriteOf(fileName);
    if (!rewrite?.inSlot(position)) return service.getQuickInfoAtPosition(fileName, position, ...rest);
    const quickInfo = shadow.getQuickInfoAtPosition(fileName, rewrite.toRewritten(position), ...rest);
    return quickInfo && { ...quickInfo, textSpan: mapSpan(rewrite, quickInfo.textSpan) };
  };

  proxy.getCompletionsAtPosition = (fileName, position, options, formatting) => {
    const rewrite = rewriteOf(fileName);
    if (!rewrite?.inSlot(position)) return service.getCompletionsAtPosition(fileName, position, options, formatting);
    const completions = shadow.getCompletionsAtPosition(fileName, rewrite.toRewritten(position), options, formatting);
    if (!completions) return completions;
    return {
      ...completions,
      ...(completions.optionalReplacementSpan && {
        optionalReplacementSpan: mapSpan(rewrite, completions.optionalReplacementSpan),
      }),
      entries: completions.entries.map((entry) =>
        entry.replacementSpan ? { ...entry, replacementSpan: mapSpan(rewrite, entry.replacementSpan) } : entry,
      ),
    };
  };

  proxy.getCompletionEntryDetails = (fileName, position, ...rest) => {
    const rewrite = rewriteOf(fileName);
    if (!rewrite?.inSlot(position)) return service.getCompletionEntryDetails(fileName, position, ...rest);
    return shadow.getCompletionEntryDetails(fileName, rewrite.toRewritten(position), ...rest);
  };

  proxy.getSignatureHelpItems = (fileName, position, options) => {
    const rewrite = rewriteOf(fileName);
    if (!rewrite?.inSlot(position)) return service.getSignatureHelpItems(fileName, position, options);
    const help = shadow.getSignatureHelpItems(fileName, rewrite.toRewritten(position), options);
    return help && { ...help, applicableSpan: mapSpan(rewrite, help.applicableSpan) };
  };

  return proxy;
};

/** The plugin module tsserver loads: a function of the TypeScript it runs on */
const init = (modules: { typescript: Typescript }): ts.server.PluginModule => ({
  create: (info) => create(modules.typescript, info),
});

export default init;
