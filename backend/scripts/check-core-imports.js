#!/usr/bin/env node
/*
 * Simple path hygiene guard.  Recursively scans the backend/services/strategies
 * directory for import or require statements that reference "../core".  The
 * project convention requires core modules be imported using "./core/..." when
 * consumed from within the strategies subtree.  If any offending paths are
 * found this script prints them and exits with a non-zero status.  This
 * script should be run as part of CI to prevent accidental regressions.
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'backend', 'services', 'strategies');
let bad = [];

function scan(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      scan(full);
    } else if (ent.isFile() && full.endsWith('.js')) {
      const content = fs.readFileSync(full, 'utf8');
      const requireMatch = /require\(['"]\.\.(\/|\\)core/.test(content);
      const importMatch = /from ['"]\.\.(\/|\\)core/.test(content);
      if (requireMatch || importMatch) {
        bad.push(path.relative(root, full));
      }
    }
  }
}

try {
  if (fs.existsSync(root)) {
    scan(root);
  }
} catch (err) {
  console.error('Error scanning strategies directory:', err.message);
  process.exit(1);
}

if (bad.length) {
  console.error('Found forbidden core imports (use "./core/..." instead of "../core/..." ) in:');
  bad.forEach((f) => console.error(f));
  process.exit(1);
}