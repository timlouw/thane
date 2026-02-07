#!/usr/bin/env node

/**
 * Thane CLI entry point
 */

import { cliMain } from './cli-common.js';

cliMain().catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
