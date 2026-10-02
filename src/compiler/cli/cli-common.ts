import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { CLIOptions, BuildConfig, ThaneBuildOptions, ThaneConfigFile } from './types.js';
import { runBuild } from './build.js';
import { syncProjectTypes } from '../plugins/router-typegen/router-typegen.js';
import { runProjectTypeCheck } from '../plugins/tsc-type-checker/tsc-type-checker.js';
import { logger } from '../utils/index.js';

const COMMANDS = new Set(['build', 'dev', 'serve', 'types', 'typecheck']);

const DEFAULT_OPTIONS: CLIOptions = {
  command: 'build',
  prod: false,
  gzip: false,
  serve: false,
  logLevel: 'normal',
};

type OptionValue = CLIOptions[keyof CLIOptions];

interface OptionSpec {
  key: keyof CLIOptions;
  /** Flags that store a fixed value. With a config file, the flags present apply in this order. */
  set?: Record<string, OptionValue>;
  /** A flag that takes the next argument, stored through `parse` (default: as given). */
  flag?: string;
  /** Parses the argument; its fallback is the value of a bare flag. */
  parse?: (value: string | undefined) => OptionValue;
  /** Also read from config files (top level and per command). */
  config?: true;
}

const parsePort = (value: string): number => {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid --port value '${value}': expected a number, e.g. --port 4200.`);
  return Number(value);
};

const toggle = (key: keyof CLIOptions, name: string): OptionSpec => ({
  key,
  set: { [`--${name}`]: true, [`--no-${name}`]: false },
  config: true,
});

/** Every CLI option and config key, in config order. */
const OPTIONS: OptionSpec[] = [
  { key: 'prod', set: { '--prod': true, '-p': true }, config: true },
  { key: 'gzip', set: { '--gzip': true }, config: true },
  { key: 'entry', flag: '--entry', config: true },
  { key: 'outDir', flag: '--out', config: true },
  { key: 'assetsDir', flag: '--assets', config: true },
  { key: 'publicDir', flag: '--public', config: true },
  { key: 'html', flag: '--html', config: true },
  { key: 'logLevel', set: { '--verbose': 'verbose', '-V': 'verbose', '--quiet': 'silent', '-q': 'silent' } },
  { key: 'configPath', flag: '--config' },
  toggle('dropConsole', 'drop-console'),
  toggle('dropDebugger', 'drop-debugger'),
  toggle('sourcemap', 'sourcemap'),
  { key: 'strictTypeCheck', set: { '--strict-type-check': true }, config: true },
  { key: 'port', flag: '--port', parse: (v) => (v ? parsePort(v) : 4200), config: true },
  toggle('open', 'open'),
  { key: 'host', flag: '--host', parse: (v) => v || '0.0.0.0', config: true },
  { key: 'base', flag: '--base', parse: (v) => v || '/', config: true },
  {
    key: 'target',
    flag: '--target',
    parse: (v) =>
      (v || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    config: true,
  },
  toggle('hashFileNames', 'hash-file-names'),
  { key: 'define', config: true },
  { key: 'envPrefix', flag: '--env-prefix', parse: (v) => v || 'THANE_', config: true },
  toggle('emptyOutDir', 'empty-out-dir'),
  toggle('splitting', 'splitting'),
  { key: 'legalComments', flag: '--legal-comments', parse: (v) => v || 'none', config: true },
  toggle('analyze', 'analyze'),
  { key: 'lint', config: true },
  { key: 'exitRequested', set: { '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' } },
];

/** Each flag with the option it sets, and either its fixed value or its argument parser. */
const FLAGS = new Map<string, { key: keyof CLIOptions; value?: OptionValue; parse?: OptionSpec['parse'] }>();
for (const { key, set = {}, flag, parse } of OPTIONS) {
  for (const [name, value] of Object.entries(set)) FLAGS.set(name, { key, value });
  if (flag) FLAGS.set(flag, { key, parse: parse ?? ((v) => v) });
}
const VALUE_FLAGS = new Set(OPTIONS.flatMap(({ flag }) => (flag ? [flag] : [])));
const CONFIG_KEYS = OPTIONS.filter((o) => o.config).map((o) => o.key as keyof ThaneBuildOptions);

const setOption = (options: Partial<CLIOptions>, key: keyof CLIOptions, value: unknown): void => {
  (options as Record<string, unknown>)[key] = value;
};

const toAbsoluteIfRelative = (value: string, baseDir: string): string =>
  isAbsolute(value) ? value : resolve(baseDir, value);

const getPositionalCommand = (args: string[], flagsWithValue: Set<string>): CLIOptions['command'] | null => {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    if (flagsWithValue.has(arg)) {
      i++; // skip the value
      continue;
    }
    if (!arg.startsWith('-') && COMMANDS.has(arg)) {
      return arg as CLIOptions['command'];
    }
  }
  return null;
};

const applyCommandModeDefaults = (options: CLIOptions): CLIOptions => {
  if (options.command === 'dev') {
    return { ...options, serve: true, prod: false };
  }
  if (options.command === 'serve') {
    return { ...options, serve: true };
  }
  return options;
};

const coerceConfigToCLIOptions = (cfg: ThaneBuildOptions | undefined): Partial<CLIOptions> => {
  const options: Partial<CLIOptions> = {};
  if (!cfg) return options;
  for (const key of CONFIG_KEYS) if (cfg[key] != null) setOption(options, key, cfg[key]);
  return options;
};

const absolutizeConfigPaths = (opts: Partial<CLIOptions>, baseDir: string): Partial<CLIOptions> => {
  return {
    ...opts,
    ...(opts.entry ? { entry: toAbsoluteIfRelative(opts.entry, baseDir) } : {}),
    ...(opts.outDir ? { outDir: toAbsoluteIfRelative(opts.outDir, baseDir) } : {}),
    ...(opts.assetsDir ? { assetsDir: toAbsoluteIfRelative(opts.assetsDir, baseDir) } : {}),
    ...(opts.html ? { html: toAbsoluteIfRelative(opts.html, baseDir) } : {}),
  };
};

const loadConfigFile = (configPath?: string): { path: string; config: ThaneConfigFile } | null => {
  const cwd = process.cwd();
  const resolvedPath = configPath
    ? toAbsoluteIfRelative(configPath, cwd)
    : [resolve(cwd, 'thane.config.json'), resolve(cwd, 'thane.config.jsonc')].find((p) => existsSync(p));

  if (!resolvedPath || !existsSync(resolvedPath)) {
    return null;
  }

  const read = ts.readConfigFile(resolvedPath, ts.sys.readFile);
  if (read.error) {
    const message = ts.flattenDiagnosticMessageText(read.error.messageText, '\n');
    throw new Error(`Invalid config file at ${resolvedPath}: ${message}`);
  }

  const value = read.config;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid config file at ${resolvedPath}: expected a JSON object.`);
  }

  return { path: resolvedPath, config: value as ThaneConfigFile };
};

/** The known name closest to `name`: the same letters in another case, or one or two edits away. */
const closestName = (name: string, known: Iterable<string>): string | undefined => {
  const distance = (a: string, b: string): number => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diagonal = row[0]!;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const above = row[j]!;
        row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return row[b.length]!;
  };
  let best: { name: string; score: number } | undefined;
  for (const candidate of known) {
    const score = candidate.toLowerCase() === name.toLowerCase() ? 0 : distance(name, candidate);
    if (score <= 2 && (!best || score < best.score)) best = { name: candidate, score };
  }
  return best?.name;
};

const LINT_SEVERITIES: ReadonlySet<string> = new Set(['off', 'warning', 'error']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Warn about what a config file holds that nothing reads: a misspelled key (`outdir`), an unknown
 * command in `commands`, or a section that is not an object. Each would otherwise be ignored silently.
 */
const warnAboutUnreadConfig = (config: Record<string, unknown>, file: string): void => {
  const name = basename(file);
  const warn = (what: string, near?: string) =>
    console.warn(`Warning: ${what} in ${name} is ignored${near ? `; did you mean '${near}'?` : '.'}`);
  const checkKeys = (section: Record<string, unknown>, where: string) => {
    for (const key of Object.keys(section)) {
      if (!CONFIG_KEYS.includes(key as keyof ThaneBuildOptions)) {
        warn(`Unknown key '${key}'${where}`, closestName(key, CONFIG_KEYS));
      }
    }
  };
  /** `lint`: an object of codes, each "off", "warning" or "error" */
  const checkLint = (lint: unknown, where: string) => {
    if (lint == null) return;
    if (!isPlainObject(lint)) return warn(`'lint'${where}, which is not an object of codes,`);
    for (const [code, severity] of Object.entries(lint)) {
      if (!LINT_SEVERITIES.has(severity as string)) {
        warn(
          `The severity ${JSON.stringify(severity)} of '${code}' in 'lint'${where} (use "off", "warning" or "error")`,
        );
      } else if (!/^THANE\d{3}$/.test(code)) {
        warn(`'${code}' in 'lint'${where}, which is not a code such as THANE405,`);
      }
    }
  };
  const { commands, $schema: _schema, ...topLevel } = config;
  checkKeys(topLevel, '');
  checkLint(topLevel['lint'], '');
  if (commands == null) return;
  if (!isPlainObject(commands)) return warn("'commands', which is not an object of command names,");
  for (const [command, section] of Object.entries(commands)) {
    if (!COMMANDS.has(command)) warn(`Unknown command '${command}' in 'commands'`, closestName(command, COMMANDS));
    else if (section == null) continue;
    else if (!isPlainObject(section)) warn(`'commands.${command}', which is not an object,`);
    else {
      checkKeys(section, ` in 'commands.${command}'`);
      checkLint(section['lint'], ` in 'commands.${command}'`);
    }
  }
};

const mergeCLIAndConfig = (args: string[], parsedCLI: CLIOptions): CLIOptions => {
  const loaded = loadConfigFile(parsedCLI.configPath);
  if (!loaded) {
    return applyCommandModeDefaults(parsedCLI);
  }
  warnAboutUnreadConfig(loaded.config as Record<string, unknown>, loaded.path);

  const cfgDir = dirname(loaded.path);
  const topLevel = absolutizeConfigPaths(coerceConfigToCLIOptions(loaded.config), cfgDir);
  const perCommand = absolutizeConfigPaths(
    coerceConfigToCLIOptions(loaded.config.commands?.[parsedCLI.command]),
    cfgDir,
  );

  let merged: CLIOptions = {
    ...DEFAULT_OPTIONS,
    ...topLevel,
    ...perCommand,
    command: parsedCLI.command,
    configPath: loaded.path,
  };

  // CLI overrides config (Angular/React-style precedence). A value flag overrides with the value
  // parseArgs gave it (a bare flag's default too) unless that is empty.
  for (const { key, set = {}, flag } of OPTIONS) {
    for (const [name, value] of Object.entries(set)) if (args.includes(name)) setOption(merged, key, value);
    const value = parsedCLI[key];
    if (flag && args.includes(flag) && value != null && value !== '') {
      setOption(merged, key, key === 'configPath' ? toAbsoluteIfRelative(value as string, process.cwd()) : value);
    }
  }

  return applyCommandModeDefaults(merged);
};

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = { ...DEFAULT_OPTIONS };

  const commandArg = getPositionalCommand(args, VALUE_FLAGS);
  if (commandArg) {
    options.command = commandArg;
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const flag = FLAGS.get(arg);
    if (flag?.parse) {
      // A value flag takes the next argument unless there is none or it is a flag: then it is bare
      const next = args[i + 1];
      setOption(options, flag.key, flag.parse(next === undefined || next.startsWith('-') ? undefined : args[++i]));
    } else if (flag) {
      setOption(options, flag.key, flag.value);
    } else if (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2)) {
      console.warn(`Warning: Unknown flag '${arg}'. Run 'thane --help' to see available options.`);
    } else if (arg !== '' && !arg.startsWith('-') && !COMMANDS.has(arg)) {
      console.warn(`Warning: Unknown command '${arg}'. Run 'thane --help' to see available commands.`);
    }
  }

  return applyCommandModeDefaults(options);
}

export function printHelp(): void {
  console.log(`
Thane CLI - Component Framework Build Tool

Usage:
  thane <command> [options]

Commands:
  build       Build the application
  dev         Start development server with watch mode
  serve       Build and serve the application
  types       Generate hidden .thane types without building
  typecheck   Run Thane-aware TypeScript checking without building

Options:
  --prod, -p          Production build (default: development)
  --gzip              Enable gzip compression (production only)
  --entry <path>      Custom entry point (default: ./src/main.ts)
  --out <dir>         Output directory (default: ./dist)
  --assets <dir>      Assets directory (default: ./src/assets)
  --public <dir>      Folder copied to the root of the output (default: ./public)
  --html <path>       Root HTML file (default: ./index.html)
  --config <path>     Path to thane config file (default: ./thane.config.json or .jsonc)
  --drop-console      Strip console.* calls from the bundle (default: on in prod)
  --no-drop-console   Keep console.* calls in the bundle (even in prod)
  --drop-debugger     Strip debugger statements (default: on in prod)
  --no-drop-debugger  Keep debugger statements (even in prod)
  --sourcemap         Generate source maps (default: on in dev)
  --no-sourcemap      Disable source maps (even in dev)
  --strict-type-check Fail build on TypeScript type errors (default: warn only)
  --port <number>     Dev server port (default: 4200)
  --open              Auto-open browser on dev server start
  --no-open           Do not auto-open browser
  --host <addr>       Dev server host address (default: localhost; use 0.0.0.0 for LAN)
  --base <path>       Public base path for deployed assets (default: /)
  --target <targets>  Comma-separated esbuild targets (e.g. es2022,chrome120)
  --hash-file-names   Include content hashes in output filenames (default: on)
  --no-hash-file-names  Disable content hashes in output filenames
  --env-prefix <pre>  Only env vars with this prefix are injected as defines (default: THANE_)
  --empty-out-dir     Clear output directory before building (default: on)
  --no-empty-out-dir  Keep existing output directory contents
  --splitting         Enable code splitting (default: on)
  --no-splitting      Disable code splitting (single bundle)
  --legal-comments <mode>  Handle license comments: none, eof, linked, external (default: none)
  --analyze           Write esbuild metafile to dist for bundle analysis
  --no-analyze        Do not write metafile (default)
  --verbose, -V       Verbose output (show debug info)
  --quiet, -q         Suppress all non-error output
  --help, -h          Show this help message
  --version, -v       Show version number

Examples:
  thane dev                    Start dev server
  thane build --prod           Production build
  thane serve --prod --gzip    Production build with gzip and server
  thane types                  Generate hidden project types only
  thane typecheck              Run typecheck with generated .thane types included
  thane build --verbose        Build with detailed logging
`);
}

export function printVersion(): void {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packagePath = join(__dirname, '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    console.log(`thane v${pkg.version}`);
  } catch {
    console.log('thane v0.0.0');
  }
}

export function createBuildConfig(options: CLIOptions): BuildConfig {
  const indexHTMLFileName = 'index.html';

  const distDir = options.outDir ?? './dist';
  const assetsInputDir = options.assetsDir ?? './src/assets';
  const assetsOutputDir = `${distDir}/assets`;
  // ./public by default, unless it is the assets folder, which is copied into assets/ already
  const publicInputDir =
    options.publicDir ?? (resolve(assetsInputDir) === resolve('./public') ? undefined : './public');
  const inputHTMLFilePath = options.html ?? `./${indexHTMLFileName}`;
  const outputHTMLFilePath = `${distDir}/${indexHTMLFileName}`;
  const entryPoints = options.entry ? [options.entry] : ['./src/main.ts'];

  // Collect THANE_* (or custom prefix) env vars as compile-time defines
  const envPrefix = options.envPrefix ?? 'THANE_';
  const envDefines: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(envPrefix) && value !== undefined) {
      envDefines[`import.meta.env.${key}`] = JSON.stringify(value);
    }
  }

  return {
    entryPoints,
    outDir: distDir,
    assetsInputDir,
    assetsOutputDir,
    publicInputDir,
    inputHTMLFilePath,
    outputHTMLFilePath,
    isProd: options.prod,
    serve: options.serve,
    useGzip: options.gzip,
    dropConsole: options.dropConsole ?? options.prod,
    dropDebugger: options.dropDebugger ?? options.prod,
    sourcemap: options.sourcemap ?? !options.prod,
    strictTypeCheck: options.strictTypeCheck ?? false,
    port: options.port ?? 4200,
    open: options.open ?? false,
    host: typeof options.host === 'boolean' ? (options.host ? '0.0.0.0' : 'localhost') : (options.host ?? 'localhost'),
    base: options.base ?? '/',
    target: options.target ?? [],
    hashFileNames: options.hashFileNames ?? true,
    define: { ...envDefines, ...(options.define ?? {}) },
    envPrefix,
    emptyOutDir: options.emptyOutDir ?? true,
    splitting: options.splitting ?? true,
    legalComments: options.legalComments ?? 'none',
    analyze: options.analyze ?? false,
    // Only the codes the config sets to a known severity: anything else was warned about
    lint: Object.fromEntries(
      Object.entries(options.lint ?? {}).filter(([, severity]) => LINT_SEVERITIES.has(severity)),
    ) as BuildConfig['lint'],
  };
}

export function resolveCLIOptions(args: string[]): CLIOptions {
  const parsedCLI = parseArgs(args);
  return mergeCLIAndConfig(args, parsedCLI);
}

export async function cliMain(): Promise<void> {
  const args = process.argv.slice(2);
  const cliOptions = resolveCLIOptions(args);

  // Handle --help / --version (print and exit without building)
  if (cliOptions.exitRequested === 'help') {
    printHelp();
    return;
  }
  if (cliOptions.exitRequested === 'version') {
    printVersion();
    return;
  }

  // Wire log level from CLI flags
  logger.setLevel(cliOptions.logLevel);

  if (cliOptions.command === 'types') {
    const generatedCount = await syncProjectTypes(process.cwd());
    if (generatedCount > 0) {
      logger.info('types-sync', `Generated hidden type file(s) for ${generatedCount} route table(s)`);
    }
    return;
  }

  if (cliOptions.command === 'typecheck') {
    await runProjectTypeCheck({ strict: true, projectRoot: process.cwd() });
    return;
  }

  const buildConfig = createBuildConfig(cliOptions);
  await runBuild(buildConfig);
}
