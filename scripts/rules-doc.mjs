// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// Writes docs/rules.md from the rule catalogue (src/core/rules.ts), so the
// documentation cannot drift from the code. A test checks it is current.
//   npm run build && node scripts/rules-doc.mjs

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const STATUS = {
  requirement: 'Requirement',
  interpretation: 'Interpretation',
  recommendation: 'Recommendation',
  safety: 'Safety limit',
};

const esc = (s) => s.replace(/\|/g, '\\|');

/** The Markdown document for a list of rules. */
export function rulesMarkdown(rules) {
  const lines = [
    '# Rules',
    '',
    'Every check Plotline runs, generated from `src/core/rules.ts`. Status:',
    '',
    '- **Requirement**: stated in Regulation (EU) 2023/1115 or in the Commission\'s EUDR Information System documentation as required or rejected.',
    '- **Interpretation**: Plotline\'s reading of a general official rule (for example "invalid geometry") in a case the text does not spell out.',
    '- **Recommendation**: recommended by an official document, a SHOULD in RFC 7946, or Plotline good practice. Never a legal requirement.',
    '- **Safety limit**: Plotline\'s own protection against hostile or broken input.',
    '',
    'Quotes are verbatim from the cited text (checked by `test/sources.test.ts` against copies in `test-vectors/sources/`).',
    '',
    '| Rule | Status | Severity | Repair | Sources |',
    '|---|---|---|---|---|',
  ];
  for (const r of rules) {
    const sources = r.sources.length === 0 ? 'Plotline' : r.sources.map((s) => `[${esc(s.cite)}](${s.url})`).join('<br>');
    lines.push(`| \`${r.id}\`<br>${esc(r.title)} | ${STATUS[r.status]} | ${r.severity} | ${r.fix === null ? 'no' : 'yes'} | ${sources} |`);
  }
  lines.push('', '## Quotes and repairs', '');
  for (const r of rules) {
    lines.push(`### \`${r.id}\``, '', r.title + '.', '');
    if (r.quote !== null) lines.push(`> ${r.quote}`, '', `— ${r.sources[0]?.cite ?? ''}`, '');
    if (r.fix !== null) lines.push(`Repair: ${r.fix}`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // eslint-disable-next-line no-restricted-syntax -- loads this package's own build output, a fixed path, not user input
  const { RULES } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')).href);
  await writeFile(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'rules.md'), rulesMarkdown(RULES));
  process.stdout.write('wrote docs/rules.md\n');
}
