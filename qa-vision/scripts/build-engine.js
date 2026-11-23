#!/usr/bin/env node
/**
 * Rebuild qa-vision/playwright.js (the CommonJS copy of lib/playwright.ts loaded by server.js).
 * Run after ANY change to lib/playwright.ts:   npm run build:engine
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, '.engine-build');
const tsc = require.resolve('typescript/bin/tsc', { paths: [root] });

fs.rmSync(outDir, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    tsc,
    path.join(root, 'lib', 'playwright.ts'),
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

fs.copyFileSync(path.join(outDir, 'playwright.js'), path.join(root, 'playwright.js'));
fs.rmSync(outDir, { recursive: true, force: true });
console.log('✔ playwright.js rebuilt from lib/playwright.ts');
