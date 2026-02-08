import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { CLIOptions, BuildConfig } from './types.js';
import { runBuild } from './build.js';

export function parseArgs(args: string[]): CLIOptions {
  const options: CLIOptions = {
    command: 'build',
    prod: false,
    gzip: false,
    app: 'client',
    serve: false,
  };

  const knownFlags = new Set([
    '--prod', '-p', '--gzip', '--app', '--entry', '--out',
    '--assets', '--html', '--help', '-h', '--version', '-v',
  ]);
  const flagsWithValue = new Set(['--app', '--entry', '--out', '--assets', '--html']);

  const commandArg = args.find((arg) => !arg.startsWith('-'));
  if (commandArg && ['build', 'dev', 'serve'].includes(commandArg)) {
    options.command = commandArg as 'build' | 'dev' | 'serve';
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--prod':
      case '-p':
        options.prod = true;
        break;
      case '--gzip':
        options.gzip = true;
        break;
      case '--app':
        options.app = args[++i] || 'client';
        break;
      case '--entry':
        options.entry = args[++i];
        break;
      case '--out':
        options.outDir = args[++i];
        break;
      case '--assets':
        options.assetsDir = args[++i];
        break;
      case '--html':
        options.htmlTemplate = args[++i];
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      case '--version':
      case '-v':
        printVersion();
        process.exit(0);
      default:
        if (arg && (arg.startsWith('--') || (arg.startsWith('-') && arg.length === 2))) {
          // Skip values consumed by flags with arguments
          const prevArg = args[i - 1];
          if (prevArg && flagsWithValue.has(prevArg)) break;
          if (!knownFlags.has(arg)) {
            console.warn(`Warning: Unknown flag '${arg}'. Run 'thane --help' to see available options.`);
          }
        }
        break;
    }
  }

  // dev command implies serve + no prod
  if (options.command === 'dev') {
    options.serve = true;
    options.prod = false;
  } else if (options.command === 'serve') {
    options.serve = true;
  }

  return options;
}

export function printHelp(): void {
  console.log(`
Thane CLI - Web Component Framework Build Tool

Usage:
  thane <command> [options]

Commands:
  build       Build the application
  dev         Start development server with watch mode
  serve       Build and serve the application

Options:
  --prod, -p          Production build (default: development)
  --gzip              Enable gzip compression (production only)
  --app <name>        Application name (default: client)
  --entry <path>      Custom entry point (default: ./src/main.ts)
  --out <dir>         Output directory (default: ./dist)
  --assets <dir>      Assets directory (default: ./src/assets)
  --html <path>       HTML template file (default: ./index.html)
  --help, -h          Show this help message
  --version, -v       Show version number

Examples:
  thane dev                    Start dev server
  thane build --prod           Production build
  thane serve --prod --gzip    Production build with gzip and server
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
  
  const distDir = options.outDir ?? `./dist/${options.app}`;
  const assetsInputDir = options.assetsDir ?? `./apps/${options.app}/assets`;
  const assetsOutputDir = `${distDir}/assets`;
  const inputHTMLFilePath = options.htmlTemplate ?? `./apps/${indexHTMLFileName}`;
  const outputHTMLFilePath = `${distDir}/${indexHTMLFileName}`;
  const entryPoints = options.entry ? [options.entry] : [`./apps/${options.app}/main.ts`];
  
  return {
    entryPoints,
    outDir: distDir,
    assetsInputDir,
    assetsOutputDir,
    inputHTMLFilePath,
    outputHTMLFilePath,
    isProd: options.prod,
    serve: options.serve,
    useGzip: options.gzip,
  };
}

export async function cliMain(): Promise<void> {
  const args = process.argv.slice(2);
  const cliOptions = parseArgs(args);
  const buildConfig = createBuildConfig(cliOptions);
  
  await runBuild(buildConfig);
}
