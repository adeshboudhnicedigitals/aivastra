#!/usr/bin/env node
// esbuild bundles each entry point into a single dependency-free file — this
// matters specifically for the content script: Chrome's `content_scripts`
// manifest entry always runs it as a classic (non-module) script, with no
// equivalent of background's "type": "module", so a plain tsc-emitted file
// with bare `import`/`export` statements throws a SyntaxError and never runs
// at all (background and the popup HTML's <script type="module"> don't have
// this problem, which is why login via the popup worked while the on-page
// widget silently did nothing). tsc still runs separately, for type-checking
// only — esbuild does not type-check.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });

execFileSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});

await esbuild.build({
  entryPoints: {
    'background/index': join(root, 'src/background/index.ts'),
    'content/index': join(root, 'src/content/index.ts'),
    'popup/popup': join(root, 'src/popup/popup.ts'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome110',
  sourcemap: true,
  logLevel: 'info',
});

const copies = [
  ['manifest.json', 'manifest.json'],
  ['src/popup/index.html', 'popup/index.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/content/widget.css', 'content/widget.css'],
  ['icons/icon16.png', 'icons/icon16.png'],
  ['icons/icon48.png', 'icons/icon48.png'],
  ['icons/icon128.png', 'icons/icon128.png'],
];

for (const [from, to] of copies) {
  const dest = join(dist, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(root, from), dest);
}

console.log(`Built extension to ${dist} — load it unpacked via chrome://extensions.`);
