/**
 * Characterisation of CLI option handling that the golden matrix (cli-matrix.test.ts) does not
 * reach: the help text verbatim, arguments named like Object.prototype members,
 * config files with unusual value shapes, and a repeated --config.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cliMain, createBuildConfig, parseArgs, printHelp, resolveCLIOptions } from './cli-common.js';

const originalCwd = process.cwd();
let root = '';

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'thane-cli-options-')));
});

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(root, { recursive: true, force: true });
});

let dirCount = 0;
/** Resolve `args` in a fresh directory holding the given files; returns the result and any warnings. */
const resolveWith = (files: Record<string, string>, args: string[]) => {
  const dir = join(root, `d${dirCount++}`);
  mkdirSync(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  process.chdir(dir);
  try {
    const result = resolveCLIOptions(args);
    return { dir, result, warnings: warn.mock.calls.map((c) => c.join(' ')) };
  } finally {
    process.chdir(originalCwd);
    warn.mockRestore();
  }
};

const unknown = (flag: string) => `Warning: Unknown flag '${flag}'. Run 'thane --help' to see available options.`;
const unknownCommand = (arg: string) =>
  `Warning: Unknown command '${arg}'. Run 'thane --help' to see available commands.`;

test('help text is unchanged', () => {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    printHelp();
    expect(log.mock.calls.length).toBe(1);
    const golden = readFileSync(join(import.meta.dir, 'cli-help.golden.txt'), 'utf8');
    expect(log.mock.calls[0]![0]).toBe(golden);
  } finally {
    log.mockRestore();
  }
});

describe('arguments named like Object.prototype members', () => {
  for (const arg of ['--constructor', '--toString', '--__proto__', '--hasOwnProperty', '-c']) {
    test(`${arg} is an unknown flag`, () => {
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const opts = parseArgs([arg]);
        expect(warn.mock.calls.map((c) => c.join(' '))).toEqual([unknown(arg)]);
        expect(opts).toEqual(parseArgs([]));
        expect(Object.keys(opts).sort()).toEqual(['command', 'gzip', 'logLevel', 'prod', 'serve']);
      } finally {
        warn.mockRestore();
      }
    });
  }
  for (const arg of ['constructor', 'toString', '__proto__', 'valueOf']) {
    test(`${arg} is a stray positional, and is warned about`, () => {
      const warn = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const opts = parseArgs([arg]);
        expect(warn.mock.calls.map((c) => c.join(' '))).toEqual([unknownCommand(arg)]);
        expect(opts).toEqual(parseArgs([]));
      } finally {
        warn.mockRestore();
      }
    });
  }
});

describe('config files', () => {
  test('null values are skipped; false, 0 and empty strings are kept', () => {
    const cfg = {
      prod: null,
      gzip: false,
      port: 0,
      host: '',
      base: null,
      entry: '',
      outDir: null,
      target: [],
      define: {},
      envPrefix: '',
      splitting: false,
      logLevel: 'verbose',
      configPath: './elsewhere.json',
      exitRequested: 'help',
      serve: true,
      command: 'dev',
    };
    const { dir, result, warnings } = resolveWith({ 'thane.config.json': JSON.stringify(cfg) }, []);
    // The CLI-only keys are not read from a config file, and each is reported
    expect(warnings).toEqual(
      ['logLevel', 'configPath', 'exitRequested', 'serve', 'command'].map(
        (key) => `Warning: Unknown key '${key}' in thane.config.json is ignored.`,
      ),
    );
    expect(result).toEqual({
      command: 'build',
      prod: false,
      gzip: false,
      serve: false,
      logLevel: 'normal',
      port: 0,
      host: '',
      entry: '',
      target: [],
      define: {},
      envPrefix: '',
      splitting: false,
      configPath: join(dir, 'thane.config.json'),
    });
  });

  test('per-command sections of any shape', () => {
    const cfg = {
      base: '/top/',
      commands: { build: 'x', dev: 5, serve: [1], types: null, typecheck: { base: '/tc/' } },
    };
    const files = { 'thane.config.json': JSON.stringify(cfg) };
    for (const command of ['build', 'dev', 'serve', 'types']) {
      expect(resolveWith(files, [command]).result.base).toBe('/top/');
    }
    expect(resolveWith(files, ['typecheck']).result.base).toBe('/tc/');
  });

  test('commands that is not an object', () => {
    for (const commands of ['build', 3, null, []]) {
      const { result } = resolveWith({ 'thane.config.json': JSON.stringify({ port: 1, commands }) }, []);
      expect(result.port).toBe(1);
    }
  });

  test('per-command define replaces the top-level define', () => {
    const cfg = { define: { A: '1', B: '2' }, commands: { build: { define: { C: '3' } } } };
    const { result } = resolveWith({ 'thane.config.json': JSON.stringify(cfg) }, []);
    expect(result.define).toEqual({ C: '3' });
  });

  test('config paths resolve against the config file; --config against the working directory', () => {
    const cfg = { entry: './e.ts', outDir: 'out', assetsDir: '/abs/assets', html: '' };
    const { dir, result } = resolveWith({ 'thane.config.json': '{}', 'other.json': JSON.stringify(cfg) }, [
      '--config',
      'other.json',
    ]);
    expect(result.configPath).toBe(join(dir, 'other.json'));
    expect(result.entry).toBe(join(dir, 'e.ts'));
    expect(result.outDir).toBe(join(dir, 'out'));
    expect(result.assetsDir).toBe('/abs/assets');
    expect(result.html).toBe('');
  });

  test('--config twice: the last one is loaded', () => {
    const files = { 'a.json': JSON.stringify({ port: 1 }), 'b.json': JSON.stringify({ port: 2 }) };
    const { dir, result } = resolveWith(files, ['--config', 'a.json', '--config', 'b.json']);
    expect(result.port).toBe(2);
    expect(result.configPath).toBe(join(dir, 'b.json'));
  });

  test('a stray value after a boolean flag with a config file', () => {
    const { result, warnings } = resolveWith({ 'thane.config.json': JSON.stringify({ port: 1 }) }, [
      '--gzip',
      'x',
      '--no-open',
      '--nope',
    ]);
    expect(warnings).toEqual([unknownCommand('x'), unknown('--nope')]);
    expect(result.gzip).toBe(true);
    expect(result.open).toBe(false);
    expect(result.port).toBe(1);
  });
});

describe('one rule for bare value flags, with or without a config file', () => {
  const CONFIG = { 'thane.config.json': JSON.stringify({ host: 'cfg-host', port: 5000, entry: './cfg.ts' }) };

  for (const [label, files] of [
    ['no config file', {}],
    ['a config file', CONFIG],
  ] as const) {
    test(`${label}: a value flag never takes the next flag as its value`, () => {
      const { result, warnings } = resolveWith(files, ['--entry', '--prod', '--host', '--nope']);
      expect(result.prod).toBe(true);
      expect(result.host).toBe('0.0.0.0');
      expect(result.entry).toEqual(label === 'a config file' ? expect.stringMatching(/cfg\.ts$/) : undefined);
      expect(warnings).toEqual([unknown('--nope')]);
    });

    test(`${label}: a bare value flag means its default, as an empty value does`, () => {
      for (const args of [['--host'], ['--host', ''], ['--host', '--gzip']]) {
        expect(resolveWith(files, args).result.host).toBe('0.0.0.0');
      }
      for (const args of [['--port'], ['--port', '']]) expect(resolveWith(files, args).result.port).toBe(4200);
    });

    test(`${label}: a port that is not a number is refused`, () => {
      for (const port of ['abc', '30x', '1.5', 'NaN']) {
        expect(() => resolveWith(files, ['--port', port])).toThrow(`Invalid --port value '${port}': expected a number`);
      }
      expect(resolveWith(files, ['--port', '0']).result.port).toBe(0);
    });

    test(`${label}: an unknown command is reported, and the build still runs`, () => {
      const { result, warnings } = resolveWith(files, ['biuld']);
      expect(warnings).toEqual(["Warning: Unknown command 'biuld'. Run 'thane --help' to see available commands."]);
      expect(result.command).toBe('build');
    });
  }
});

describe('help and --version with a config file', () => {
  const CONFIG = { 'thane.config.json': JSON.stringify({ port: 1 }) };

  test('each flag is carried over', () => {
    for (const [flag, request] of [
      ['--help', 'help'],
      ['-h', 'help'],
      ['--version', 'version'],
      ['-v', 'version'],
    ] as const) {
      expect(resolveWith(CONFIG, ['build', flag]).result.exitRequested).toBe(request);
    }
  });

  test('thane --help prints the help and builds nothing', async () => {
    const dir = join(root, `d${dirCount++}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'thane.config.json'), CONFIG['thane.config.json']);
    const argv = process.argv;
    const log = spyOn(console, 'log').mockImplementation(() => {});
    const info = spyOn(console, 'info').mockImplementation(() => {});
    process.argv = [argv[0]!, 'thane', '--help'];
    process.chdir(dir);
    try {
      await cliMain(); // without the fix: a build, which fails for want of src/main.ts
      expect(log.mock.calls).toEqual([[readFileSync(join(import.meta.dir, 'cli-help.golden.txt'), 'utf8')]]);
      expect(info).not.toHaveBeenCalled();
    } finally {
      process.chdir(originalCwd);
      process.argv = argv;
      log.mockRestore();
      info.mockRestore();
    }
  });
});

describe('config file keys nothing reads are reported', () => {
  const warningsFor = (cfg: unknown) => resolveWith({ 'thane.config.json': JSON.stringify(cfg) }, []).warnings;

  test('a misspelled key, with the key it most likely means', () => {
    expect(warningsFor({ outdir: 'dist', portt: 1, dropconsole: false })).toEqual([
      "Warning: Unknown key 'outdir' in thane.config.json is ignored; did you mean 'outDir'?",
      "Warning: Unknown key 'portt' in thane.config.json is ignored; did you mean 'port'?",
      "Warning: Unknown key 'dropconsole' in thane.config.json is ignored; did you mean 'dropConsole'?",
    ]);
  });

  test('the removed app key, and a key that is nothing like an option', () => {
    expect(warningsFor({ app: 'x', whatever: 1 })).toEqual([
      "Warning: Unknown key 'app' in thane.config.json is ignored.",
      "Warning: Unknown key 'whatever' in thane.config.json is ignored.",
    ]);
  });

  test('commands: an unknown command, a section that is not an object, a misspelled key in a section', () => {
    expect(warningsFor({ commands: { biuld: {}, dev: 5, serve: { hots: 'x' }, types: null } })).toEqual([
      "Warning: Unknown command 'biuld' in 'commands' in thane.config.json is ignored; did you mean 'build'?",
      "Warning: 'commands.dev', which is not an object, in thane.config.json is ignored.",
      "Warning: Unknown key 'hots' in 'commands.serve' in thane.config.json is ignored; did you mean 'host'?",
    ]);
    expect(warningsFor({ commands: ['build'] })).toEqual([
      "Warning: 'commands', which is not an object of command names, in thane.config.json is ignored.",
    ]);
  });

  test('lint: severities by code; a bad severity, a key that is not a code and a lint that is not an object', () => {
    const { result, warnings } = resolveWith(
      {
        'thane.config.json': JSON.stringify({
          lint: { THANE405: 'off', THANE411: 'error', THANE404: 'warning', THANE403: 'loud', thane403: 'off' },
          commands: { build: { lint: { THANE403: 'off' } } },
        }),
      },
      [],
    );
    expect(result.lint).toEqual({ THANE403: 'off' });
    expect(warnings).toEqual([
      'Warning: The severity "loud" of \'THANE403\' in \'lint\' (use "off", "warning" or "error") in thane.config.json is ignored.',
      "Warning: 'thane403' in 'lint', which is not a code such as THANE405, in thane.config.json is ignored.",
    ]);
    const top = resolveWith(
      { 'thane.config.json': JSON.stringify({ lint: { THANE405: 'off', THANE411: 'error', x: 'loud' } }) },
      [],
    );
    expect(createBuildConfig(top.result).lint).toEqual({ THANE405: 'off', THANE411: 'error' });
    expect(
      resolveWith({ 'thane.config.json': JSON.stringify({ commands: { dev: { lint: [1] } } }) }, []).warnings,
    ).toEqual(["Warning: 'lint' in 'commands.dev', which is not an object of codes, in thane.config.json is ignored."]);
  });

  test('$schema and every option are read without a warning', () => {
    expect(warningsFor({ $schema: './schema.json', prod: true, commands: { build: { outDir: 'd' } } })).toEqual([]);
  });
});
