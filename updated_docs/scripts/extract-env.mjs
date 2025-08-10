#!/usr/bin/env node
/*
 * Environment Variable Extractor
 *
 * This script scans the backend directory for references to `process.env` and
 * outputs a sorted list of environment variable names.  It is intended as a
 * convenience when updating `docs/CONFIG_REFERENCE.md` or generating new
 * example `.env` files.  The script searches `.js` and `.ts` files
 * recursively under a given root directory.  To run:
 *
 *   node scripts/extract-env.mjs [rootDir]
 *
 * If no directory is supplied, `./backend` is used by default.
 */

import fs from 'fs';
import path from 'path';

function scanDir(dir, vars = new Set()) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, vars);
    } else if (entry.isFile() && /\.(js|ts|mjs|cjs)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const regex = /process\.env\.([A-Z0-9_]+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        vars.add(match[1]);
      }
    }
  }
  return vars;
}

const root = process.argv[2] || path.join(process.cwd(), 'backend');
const vars = Array.from(scanDir(root)).sort();
console.log(vars.join('\n'));