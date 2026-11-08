// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Builds the offline app: one self-contained HTML file with the script and
// stylesheet inlined and allowed by SHA-256 hashes in a strict Content
// Security Policy. No external resources, no network access.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';
import { build } from 'esbuild';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Builds the policy for the given script and style hashes. */
export function appCsp(scriptHash, styleHash) {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}'`,
    `style-src 'sha256-${styleHash}'`,
    "connect-src 'none'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join('; ');
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('base64');

/** Returns the built page and the hashes in its policy. */
export async function buildApp() {
  const result = await build({
    entryPoints: [join(ROOT, 'src/app/main.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: false,
    write: false,
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('esbuild produced no output');
  const script = output.text.trim();
  const style = (await readFile(join(ROOT, 'src/app/style.css'), 'utf8')).trim();
  // Inline content must not be able to close its element or open an HTML comment.
  if (/<\/script/i.test(script) || /<!--/.test(script)) throw new Error('bundle contains </script or <!--');
  if (/<\/style/i.test(style)) throw new Error('stylesheet contains </style');
  const scriptHash = sha256(script);
  const styleHash = sha256(style);
  const template = await readFile(join(ROOT, 'src/app/template.html'), 'utf8');
  // split/join, not String.replace: the bundle may contain "$&"-style sequences.
  const html = template
    .split('%CSP%')
    .join(appCsp(scriptHash, styleHash))
    .split('%STYLE%')
    .join(style)
    .split('%SCRIPT%')
    .join(script);
  return { html, script, style, scriptHash, styleHash };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { html } = await buildApp();
  const out = join(ROOT, 'dist/app/plotline.html');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, { mode: 0o644 });
  process.stdout.write(`Wrote ${out} (${html.length} bytes)\n`);
}
