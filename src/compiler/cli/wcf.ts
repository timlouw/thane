#!/usr/bin/env node

/**
 * WCF CLI entry point (alias for thane)
 */

import { cliMain } from './cli-common.js';

cliMain().catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
