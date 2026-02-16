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
    expect(parseArgs(['--html', './src/index.html']).htmlTemplate).toBe('./src/index.html');
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

  test('uses custom HTML template', () => {
    const config = createBuildConfig({ ...baseOptions, htmlTemplate: './src/template.html' });
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