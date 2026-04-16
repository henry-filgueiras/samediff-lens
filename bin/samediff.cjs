#!/usr/bin/env node

// Wrapper that loads the CommonJS-compiled CLI.
// The dist-cli/ output is CommonJS, but package.json has "type": "module",
// so we use a .cjs wrapper to avoid the module-type conflict.

const { createRequire } = require('node:module');
const { resolve } = require('node:path');

const cliRequire = createRequire(__filename);
const distDir = resolve(__dirname, '..', 'dist-cli');

// Temporarily rename require cache keys to help resolution
cliRequire(resolve(distDir, 'cli', 'index.js'));
