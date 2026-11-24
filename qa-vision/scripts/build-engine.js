#!/usr/bin/env node
/**
 * Rebuild qa-vision/engine-dist/ (compiled CommonJS tree of lib/playwright.ts + lib/engine/**)
 * and the playwright.js shim loaded by server.js.
 * Run after ANY change to lib/playwright.ts or lib/engine/:   npm run build:engine
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const finalDir = path.join(root, 'engine-dist');
// Build into a staging dir and swap it in, so concurrent readers (e2e suites, server.js) never
// see a missing or half-written engine-dist/.
const outDir = path.join(root, `engine-dist.tmp-${process.pid}`);
const tsc = require.resolve('typescript/bin/tsc', { paths: [root] });

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [p] : [];
  });
}

const files = [path.join(root, 'lib', 'playwright.ts'), ...walk(path.join(root, 'lib', 'engine'))];

fs.rmSync(outDir, { recursive: true, force: true });
try {
execFileSync(
  process.execPath,
  [
    tsc,
    ...files,
    '--rootDir', path.join(root, 'lib'),
    '--outDir', outDir,
    '--module', 'commonjs',
    '--target', 'es2022',
    '--moduleResolution', 'node',
    '--esModuleInterop',
    '--skipLibCheck',
    '--strict',
  ],
  { stdio: 'inherit', cwd: root }
);
} catch (err) {
  fs.rmSync(outDir, { recursive: true, force: true });
  throw err;
}

const oldDir = `${finalDir}.old-${process.pid}`;
if (fs.existsSync(finalDir)) fs.renameSync(finalDir, oldDir);
fs.renameSync(outDir, finalDir);
fs.rmSync(oldDir, { recursive: true, force: true });

fs.writeFileSync(path.join(root, 'playwright.js'), "module.exports = require('./engine-dist/playwright.js');\n");
console.log('engine-dist rebuilt from lib/playwright.ts + lib/engine/**');
