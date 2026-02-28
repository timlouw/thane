import { describe, test, expect, spyOn } from 'bun:test';
import { parseArgs, createBuildConfig, resolveCLIOptions, printHelp, printVersion } from './cli-common.js';
import type { CLIOptions } from './types.js';

// ─────────────────────────────────────────────────────────────
//  parseArgs
// ─────────────────────────────────────────────────────────────

describe('parseArgs', () => {
  test('returns defaults when no args are given', () => {
    const opts = parseArgs([]);
    expect(opts.command).toBe('build');
    expect(opts.prod).toBe(false);
    expect(opts.gzip).toBe(false);
    expect(opts.app).toBe('client');
    expect(opts.serve).toBe(false);
    expect(opts.logLevel).toBe('normal');
  });

  test('parses build command', () => {
    const opts = parseArgs(['build']);
    expect(opts.command).toBe('build');
    expect(opts.serve).toBe(false);
  });

  test('parses dev command and enables serve', () => {
    const opts = parseArgs(['dev']);
    expect(opts.command).toBe('dev');
    expect(opts.serve).toBe(true);
    expect(opts.prod).toBe(false);
  });

  test('parses serve command and enables serve', () => {
    const opts = parseArgs(['serve']);
    expect(opts.command).toBe('serve');
    expect(opts.serve).toBe(true);
  });

  test('parses --prod / -p flag', () => {
    expect(parseArgs(['--prod']).prod).toBe(true);
    expect(parseArgs(['-p']).prod).toBe(true);
  });

  test('parses --gzip flag', () => {
    expect(parseArgs(['--gzip']).gzip).toBe(true);
  });

  test('parses --app flag with value', () => {
    expect(parseArgs(['--app', 'my-app']).app).toBe('my-app');
  });

  test('parses --entry flag with value', () => {
    expect(parseArgs(['--entry', './src/index.ts']).entry).toBe('./src/index.ts');
  });

  test('parses --out flag with value', () => {
    expect(parseArgs(['--out', './build']).outDir).toBe('./build');
  });

  test('parses --assets flag with value', () => {
    expect(parseArgs(['--assets', './public']).assetsDir).toBe('./public');
  });

  test('parses --html flag with value', () => {
    expect(parseArgs(['--html', './src/index.html']).html).toBe('./src/index.html');
  });

  test('parses --config flag with value', () => {
    expect(parseArgs(['--config', './thane.config.json']).configPath).toBe('./thane.config.json');
  });

  test('parses --verbose / -V flag', () => {
    expect(parseArgs(['--verbose']).logLevel).toBe('verbose');
    expect(parseArgs(['-V']).logLevel).toBe('verbose');
  });

  test('parses --quiet / -q flag', () => {
    expect(parseArgs(['--quiet']).logLevel).toBe('silent');
    expect(parseArgs(['-q']).logLevel).toBe('silent');
  });

  test('combines command with flags', () => {
    const opts = parseArgs(['build', '--prod', '--gzip', '--entry', './app.ts']);
    expect(opts.command).toBe('build');
    expect(opts.prod).toBe(true);
    expect(opts.gzip).toBe(true);
    expect(opts.entry).toBe('./app.ts');
  });

  test('dev command overrides prod to false', () => {
    const opts = parseArgs(['dev', '--prod']);
    expect(opts.command).toBe('dev');
    // dev always sets prod: false, serve: true
    expect(opts.prod).toBe(false);
    expect(opts.serve).toBe(true);
  });

  test('warns on unknown flags', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    parseArgs(['--unknown-flag']);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('ignores positional args that are not commands', () => {
    const opts = parseArgs(['some-random-arg']);
    // Should still default to build
    expect(opts.command).toBe('build');
  });

  test('parses --port flag with value', () => {
    expect(parseArgs(['--port', '3000']).port).toBe(3000);
  });

  test('parses --open flag', () => {
    expect(parseArgs(['--open']).open).toBe(true);
  });

  test('parses --no-open flag', () => {
    expect(parseArgs(['--no-open']).open).toBe(false);
  });

  test('parses --host flag with value', () => {
    expect(parseArgs(['--host', '0.0.0.0']).host).toBe('0.0.0.0');
  });

  test('parses --base flag with value', () => {
    expect(parseArgs(['--base', '/app/']).base).toBe('/app/');
  });

  test('parses --target flag with comma-separated values', () => {
    const opts = parseArgs(['--target', 'es2020,chrome100']);
    expect(opts.target).toEqual(['es2020', 'chrome100']);
  });

  test('parses --hash-file-names and --no-hash-file-names flags', () => {
    expect(parseArgs(['--hash-file-names']).hashFileNames).toBe(true);
    expect(parseArgs(['--no-hash-file-names']).hashFileNames).toBe(false);
  });

  test('parses --env-prefix flag with value', () => {
    expect(parseArgs(['--env-prefix', 'MY_APP_']).envPrefix).toBe('MY_APP_');
  });

  test('parses --empty-out-dir and --no-empty-out-dir flags', () => {
    expect(parseArgs(['--empty-out-dir']).emptyOutDir).toBe(true);
    expect(parseArgs(['--no-empty-out-dir']).emptyOutDir).toBe(false);
  });

  test('parses --splitting and --no-splitting flags', () => {
    expect(parseArgs(['--splitting']).splitting).toBe(true);
    expect(parseArgs(['--no-splitting']).splitting).toBe(false);
  });

  test('parses --legal-comments flag with value', () => {
    expect(parseArgs(['--legal-comments', 'eof']).legalComments).toBe('eof');
  });

  test('parses --analyze and --no-analyze flags', () => {
    expect(parseArgs(['--analyze']).analyze).toBe(true);
    expect(parseArgs(['--no-analyze']).analyze).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
//  createBuildConfig
// ─────────────────────────────────────────────────────────────

describe('createBuildConfig', () => {
  const baseOptions: CLIOptions = {
    command: 'build',
    prod: false,
    gzip: false,
    app: 'client',
    serve: false,
    logLevel: 'normal',
  };

  test('returns correct defaults when no overrides given', () => {
    const config = createBuildConfig(baseOptions);
    expect(config.entryPoints).toEqual(['./src/main.ts']);
    expect(config.outDir).toBe('./dist');
    expect(config.isProd).toBe(false);
    expect(config.serve).toBe(false);
    expect(config.useGzip).toBe(false);
    expect(config.inputHTMLFilePath).toBe('./index.html');
    expect(config.outputHTMLFilePath).toBe('./dist/index.html');
    expect(config.dropConsole).toBe(false);
    expect(config.dropDebugger).toBe(false);
    expect(config.sourcemap).toBe(true);
    expect(config.strictTypeCheck).toBe(false);
    expect(config.port).toBe(4200);
    expect(config.open).toBe(false);
    expect(config.host).toBe('localhost');
    expect(config.base).toBe('/');
    expect(config.target).toEqual([]);
    expect(config.hashFileNames).toBe(true);
    expect(config.define).toEqual({});
    expect(config.envPrefix).toBe('THANE_');
    expect(config.emptyOutDir).toBe(true);
    expect(config.splitting).toBe(true);
    expect(config.legalComments).toBe('none');
    expect(config.analyze).toBe(false);
  });

  test('uses custom entry point', () => {
    const config = createBuildConfig({ ...baseOptions, entry: './src/app.ts' });
    expect(config.entryPoints).toEqual(['./src/app.ts']);
  });

  test('uses custom output directory', () => {
    const config = createBuildConfig({ ...baseOptions, outDir: './build' });
    expect(config.outDir).toBe('./build');
    expect(config.outputHTMLFilePath).toBe('./build/index.html');
  });

  test('uses custom assets directory', () => {
    const config = createBuildConfig({ ...baseOptions, assetsDir: './public' });
    expect(config.assetsInputDir).toBe('./public');
  });

  test('uses custom root HTML file', () => {
    const config = createBuildConfig({ ...baseOptions, html: './src/template.html' });
    expect(config.inputHTMLFilePath).toBe('./src/template.html');
  });

  test('sets production mode correctly', () => {
    const config = createBuildConfig({ ...baseOptions, prod: true });
    expect(config.isProd).toBe(true);
  });

  test('sets gzip flag correctly', () => {
    const config = createBuildConfig({ ...baseOptions, gzip: true });
    expect(config.useGzip).toBe(true);
  });

  test('sets serve flag correctly', () => {
    const config = createBuildConfig({ ...baseOptions, serve: true });
    expect(config.serve).toBe(true);
  });

  test('prod mode defaults dropConsole, dropDebugger to true and sourcemap to false', () => {
    const config = createBuildConfig({ ...baseOptions, prod: true });
    expect(config.dropConsole).toBe(true);
    expect(config.dropDebugger).toBe(true);
    expect(config.sourcemap).toBe(false);
  });

  test('dropConsole can be overridden independently of prod', () => {
    const config = createBuildConfig({ ...baseOptions, prod: true, dropConsole: false });
    expect(config.dropConsole).toBe(false);
    expect(config.dropDebugger).toBe(true);
  });

  test('dropDebugger can be overridden independently of prod', () => {
    const config = createBuildConfig({ ...baseOptions, prod: true, dropDebugger: false });
    expect(config.dropDebugger).toBe(false);
    expect(config.dropConsole).toBe(true);
  });

  test('sourcemap can be enabled in prod', () => {
    const config = createBuildConfig({ ...baseOptions, prod: true, sourcemap: true });
    expect(config.sourcemap).toBe(true);
  });

  test('sourcemap can be disabled in dev', () => {
    const config = createBuildConfig({ ...baseOptions, prod: false, sourcemap: false });
    expect(config.sourcemap).toBe(false);
  });

  test('strictTypeCheck defaults to false', () => {
    const config = createBuildConfig(baseOptions);
    expect(config.strictTypeCheck).toBe(false);
  });

  test('strictTypeCheck can be enabled', () => {
    const config = createBuildConfig({ ...baseOptions, strictTypeCheck: true });
    expect(config.strictTypeCheck).toBe(true);
  });

  test('port defaults to 4200 and can be overridden', () => {
    expect(createBuildConfig(baseOptions).port).toBe(4200);
    expect(createBuildConfig({ ...baseOptions, port: 3000 }).port).toBe(3000);
  });

  test('open defaults to false and can be enabled', () => {
    expect(createBuildConfig(baseOptions).open).toBe(false);
    expect(createBuildConfig({ ...baseOptions, open: true }).open).toBe(true);
  });

  test('host defaults to localhost and resolves boolean true to 0.0.0.0', () => {
    expect(createBuildConfig(baseOptions).host).toBe('localhost');
    expect(createBuildConfig({ ...baseOptions, host: '0.0.0.0' }).host).toBe('0.0.0.0');
    expect(createBuildConfig({ ...baseOptions, host: true }).host).toBe('0.0.0.0');
    expect(createBuildConfig({ ...baseOptions, host: false }).host).toBe('localhost');
  });

  test('base defaults to / and can be set', () => {
    expect(createBuildConfig(baseOptions).base).toBe('/');
    expect(createBuildConfig({ ...baseOptions, base: '/app/' }).base).toBe('/app/');
  });

  test('target defaults to empty array and can be overridden', () => {
    expect(createBuildConfig(baseOptions).target).toEqual([]);
    expect(createBuildConfig({ ...baseOptions, target: ['es2020', 'chrome100'] }).target).toEqual(['es2020', 'chrome100']);
  });

  test('hashFileNames defaults to true and can be disabled', () => {
    expect(createBuildConfig(baseOptions).hashFileNames).toBe(true);
    expect(createBuildConfig({ ...baseOptions, hashFileNames: false }).hashFileNames).toBe(false);
  });

  test('define defaults to empty and merges env defines', () => {
    expect(createBuildConfig(baseOptions).define).toEqual({});
    const config = createBuildConfig({ ...baseOptions, define: { '__VERSION__': '"1.0.0"' } });
    expect(config.define['__VERSION__']).toBe('"1.0.0"');
  });

  test('envPrefix defaults to THANE_', () => {
    expect(createBuildConfig(baseOptions).envPrefix).toBe('THANE_');
    expect(createBuildConfig({ ...baseOptions, envPrefix: 'MY_APP_' }).envPrefix).toBe('MY_APP_');
  });

  test('emptyOutDir defaults to true and can be disabled', () => {
    expect(createBuildConfig(baseOptions).emptyOutDir).toBe(true);
    expect(createBuildConfig({ ...baseOptions, emptyOutDir: false }).emptyOutDir).toBe(false);
  });

  test('splitting defaults to true and can be disabled', () => {
    expect(createBuildConfig(baseOptions).splitting).toBe(true);
    expect(createBuildConfig({ ...baseOptions, splitting: false }).splitting).toBe(false);
  });

  test('legalComments defaults to none and can be set', () => {
    expect(createBuildConfig(baseOptions).legalComments).toBe('none');
    expect(createBuildConfig({ ...baseOptions, legalComments: 'eof' }).legalComments).toBe('eof');
  });

  test('analyze defaults to false and can be enabled', () => {
    expect(createBuildConfig(baseOptions).analyze).toBe(false);
    expect(createBuildConfig({ ...baseOptions, analyze: true }).analyze).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
//  resolveCLIOptions (integration: parseArgs + config merge)
// ─────────────────────────────────────────────────────────────

describe('resolveCLIOptions', () => {
  test('resolves basic args without config file', () => {
    const opts = resolveCLIOptions(['build', '--prod']);
    expect(opts.command).toBe('build');
    expect(opts.prod).toBe(true);
  });

  test('resolves dev mode defaults', () => {
    const opts = resolveCLIOptions(['dev']);
    expect(opts.command).toBe('dev');
    expect(opts.serve).toBe(true);
    expect(opts.prod).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
//  printHelp / printVersion
// ─────────────────────────────────────────────────────────────

describe('printHelp', () => {
  test('outputs help text without throwing', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printHelp()).not.toThrow();
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join('');
    expect(output).toContain('thane');
    expect(output).toContain('build');
    expect(output).toContain('dev');
    expect(output).toContain('serve');
    expect(output).toContain('--prod');
    expect(output).toContain('--verbose');
    expect(output).toContain('--quiet');
    logSpy.mockRestore();
  });
});

describe('printVersion', () => {
  test('outputs version without throwing', () => {
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printVersion()).not.toThrow();
    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.flat().join('');
    expect(output).toMatch(/thane v\d/);
    logSpy.mockRestore();
  });
});
