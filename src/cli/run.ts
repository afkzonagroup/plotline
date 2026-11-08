// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The command line interface, independent of Node's process and file
 * system (they are passed in), so it can be tested end to end.
 *
 * @packageDocumentation
 */

import { convert, fix, split, toDdsProducers, validate, readPlots, type Report } from '../core/api.js';
import { validCountryOption } from '../core/fix.js';
import { DEFAULT_LIMITS, HARD_LIMITS, SYSTEM_LIMITS, type Limits } from '../core/limits.js';
import type { Change, Issue } from '../core/model.js';
import { RULES } from '../core/rules.js';
import { COMMODITIES, type Commodity, type Variant } from '../core/validate.js';
import type { InputFormat } from '../core/input.js';
import { ATTRIBUTION, ATTRIBUTION_URL, GENERATOR, VERSION } from '../version.js';
import { CliError } from './node-io.js';

/** Side effects the CLI needs. */
export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
  readFile(path: string, maxBytes: number): Promise<Uint8Array>;
  writeFile(path: string, content: string, force: boolean): Promise<void>;
  makeDir(path: string): Promise<void>;
  sameFile(a: string, b: string): Promise<boolean>;
  listFiles(root: string, pattern: string, maxFiles: number): Promise<string[]>;
  joinPath(dir: string, name: string): string;
}

const FOOTER = `${ATTRIBUTION} – ${ATTRIBUTION_URL}`;

const HELP = `Plotline ${VERSION}: geolocation files for the EU Deforestation Regulation (EU) 2023/1115

Usage:
  plotline validate <file>... [options]     check files; exit 1 when a check fails
  plotline validate --root <dir> --glob <pattern> [options]
  plotline fix <file> --out <file> [options]
  plotline stats <file> [options]
  plotline split <file> --out-dir <dir> [options]
  plotline convert <file> --out <file> [--to geojson|dds-producers] [options]
  plotline rules [--format text|json]

Input: GeoJSON (.geojson, .json), KML (.kml) or CSV of points (.csv, .tsv, .txt).

Options:
  --format text|json|github   output format (github: workflow annotations, validate only)
  --commodity <name>          cattle, cocoa, coffee, oil-palm, rubber, soya or wood
  --variant type-i|type-ii    GeoJSON file variant (default type-i)
  --input-format geojson|kml|csv
  --fail-on error|warning|never   when validate exits with 1 (default error)
  --out, -o <file>            output file (fix, convert)
  --out-dir, -d <dir>         output directory (split)
  --force                     overwrite existing output files
  --country <XX>              write this ISO 3166-1 alpha-2 code where ProducerCountry is missing
  --strip-unknown-properties  remove properties the Information System ignores
  --simplify-collinear        remove positions lying exactly on a straight side
  --no-cut-antimeridian       leave polygons that cross 180° as they are
  --keep-duplicates           keep exact duplicate plots
  --no-repair                 split without repairing first
  --repair                    repair while converting
  --max-bytes <n>             Information System size limit (default ${SYSTEM_LIMITS.maxGeolocationBytes})
  --max-producers <n>         producers per part or commodity (default ${SYSTEM_LIMITS.maxProducersPerCommodity})
  --max-input-bytes <n>       largest file Plotline reads (default ${DEFAULT_LIMITS.maxInputBytes})
  --check-budget <n>          work limit for geometry checks (default ${DEFAULT_LIMITS.checkBudget})
  --root <dir> --glob <pattern>   validate every matching file under a directory
  -h, --help                  this help
  -V, --version               version

Nothing leaves your computer. Plotline does not make network connections.
Not legal advice. Plotline checks files; it does not make anyone compliant.

${FOOTER}
`;

interface Options {
  format: 'text' | 'json' | 'github';
  commodity?: Commodity;
  variant: Variant;
  inputFormat?: InputFormat;
  failOn: 'error' | 'warning' | 'never';
  out?: string;
  outDir?: string;
  force: boolean;
  country?: string;
  stripUnknownProperties: boolean;
  simplifyCollinear: boolean;
  cutAntimeridian: boolean;
  removeDuplicates: boolean;
  repair?: boolean;
  to: 'geojson' | 'dds-producers';
  maxBytes: number;
  maxProducers: number;
  maxInputBytes: number;
  checkBudget: number;
  root?: string;
  glob?: string;
  files: string[];
}

const FLAGS = new Set(['--force', '--strip-unknown-properties', '--simplify-collinear', '--no-cut-antimeridian', '--keep-duplicates', '--no-repair', '--repair']);
const VALUED = new Set(['--format', '--commodity', '--variant', '--input-format', '--fail-on', '--out', '-o', '--out-dir', '-d', '--country', '--max-bytes', '--max-producers', '--max-input-bytes', '--check-budget', '--root', '--glob', '--to']);

function integer(name: string, text: string, min: number, max: number): number {
  if (!/^[0-9]{1,12}$/.test(text)) throw new CliError(`${name} needs a whole number.`);
  const n = Number(text);
  if (n < min || n > max) throw new CliError(`${name} must be from ${min} to ${max}.`);
  return n;
}

function oneOf<T extends string>(name: string, text: string, allowed: readonly T[]): T {
  if (!(allowed as readonly string[]).includes(text)) throw new CliError(`${name} must be one of: ${allowed.join(', ')}.`);
  return text as T;
}

/** Parses arguments after the command name. */
export function parseArgs(args: readonly string[]): Options {
  const o: Options = {
    format: 'text',
    variant: 'type-i',
    failOn: 'error',
    force: false,
    stripUnknownProperties: false,
    simplifyCollinear: false,
    cutAntimeridian: true,
    removeDuplicates: true,
    to: 'geojson',
    maxBytes: SYSTEM_LIMITS.maxGeolocationBytes,
    maxProducers: SYSTEM_LIMITS.maxProducersPerCommodity,
    maxInputBytes: DEFAULT_LIMITS.maxInputBytes,
    checkBudget: DEFAULT_LIMITS.checkBudget,
    files: [],
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const raw = args[i] as string;
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1;
    const name = eq > 0 ? raw.slice(0, eq) : raw;
    if (FLAGS.has(name)) {
      if (eq > 0) throw new CliError(`${name} takes no value.`);
      switch (name) {
        case '--force': o.force = true; break;
        case '--strip-unknown-properties': o.stripUnknownProperties = true; break;
        case '--simplify-collinear': o.simplifyCollinear = true; break;
        case '--no-cut-antimeridian': o.cutAntimeridian = false; break;
        case '--keep-duplicates': o.removeDuplicates = false; break;
        case '--no-repair': o.repair = false; break;
        default: o.repair = true; break;
      }
      continue;
    }
    if (VALUED.has(name)) {
      const key = name === '-o' ? '--out' : name === '-d' ? '--out-dir' : name;
      if (seen.has(key)) throw new CliError(`${key} is given twice.`);
      seen.add(key);
      let value: string;
      if (eq > 0) value = raw.slice(eq + 1);
      else {
        const next = args[i + 1];
        if (next === undefined) throw new CliError(`${name} needs a value.`);
        value = next;
        i++;
      }
      switch (key) {
        case '--format': o.format = oneOf(key, value, ['text', 'json', 'github'] as const); break;
        case '--commodity': o.commodity = oneOf(key, value.replace('-', ' '), COMMODITIES); break;
        case '--variant': o.variant = oneOf(key, value, ['type-i', 'type-ii'] as const); break;
        case '--input-format': o.inputFormat = oneOf(key, value, ['geojson', 'kml', 'csv'] as const); break;
        case '--fail-on': o.failOn = oneOf(key, value, ['error', 'warning', 'never'] as const); break;
        case '--out': o.out = value; break;
        case '--out-dir': o.outDir = value; break;
        case '--country':
          if (!validCountryOption(value)) throw new CliError('--country needs an ISO 3166-1 alpha-2 code in capitals, for example BR.');
          o.country = value;
          break;
        case '--max-bytes': o.maxBytes = integer(key, value, 1024, HARD_LIMITS.maxInputBytes); break;
        case '--max-producers': o.maxProducers = integer(key, value, 1, SYSTEM_LIMITS.maxProducersPerStatement); break;
        case '--max-input-bytes': o.maxInputBytes = integer(key, value, 1, HARD_LIMITS.maxInputBytes); break;
        case '--check-budget': o.checkBudget = integer(key, value, 1, HARD_LIMITS.checkBudget); break;
        case '--root': o.root = value; break;
        case '--glob': o.glob = value; break;
        default: o.to = oneOf(key, value, ['geojson', 'dds-producers'] as const); break;
      }
      continue;
    }
    if (raw.startsWith('-') && raw !== '-') throw new CliError(`Unknown option ${JSON.stringify(raw.slice(0, 40))}. See plotline --help.`);
    o.files.push(raw);
  }
  return o;
}

/**
 * Makes text safe for a terminal: control characters (including escape
 * sequences), bidirectional overrides and line separators from file content
 * are shown as \\u escapes instead of being interpreted.
 */
export function safeText(text: string): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the purpose
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Escapes a value for a GitHub workflow command (message part or property part). */
export function githubEscape(text: string, property: boolean): string {
  let out = safeText(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  if (property) out = out.replace(/:/g, '%3A').replace(/,/g, '%2C');
  return out;
}

const LABEL = { error: 'ERROR  ', warning: 'WARNING', info: 'NOTE   ' } as const;

function formatIssue(i: Issue): string {
  const where = [i.feature === null ? 'file' : `feature ${i.feature}`, i.path === '' ? null : i.path, i.line === null ? null : `line ${i.line}`].filter((x) => x !== null).join('  ');
  return `  ${LABEL[i.severity]} ${i.rule}  ${where}\n           ${i.message}\n`;
}

function formatSummary(r: Report): string {
  const s = r.summary;
  const countries = Object.entries(s.countries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c, n]) => `${c === '' ? '(none)' : c} ${n}`)
    .join(', ');
  return `  ${s.plots} plot(s): ${s.polygons} polygon(s), ${s.points} point(s)${s.other > 0 ? `, ${s.other} other` : ''}; ${s.positions} position(s); ${s.hectares.toFixed(4)} ha; ${s.producers} producer(s)${countries === '' ? '' : `; countries: ${countries}`}; ${r.bytes} bytes\n`;
}

function counts(r: Report): string {
  return `${r.summary.errors} error(s), ${r.summary.warnings} warning(s), ${r.summary.infos} note(s)`;
}

function failed(r: Report, failOn: Options['failOn']): boolean {
  if (failOn === 'never') return false;
  return r.summary.errors > 0 || (failOn === 'warning' && r.summary.warnings > 0);
}

function formatChanges(changes: readonly Change[]): string {
  if (changes.length === 0) return '  No changes were needed.\n';
  return changes.map((c) => `  CHANGED ${c.rule}  ${c.feature === null ? 'file' : `feature ${c.feature}`}${c.path === '' ? '' : `  ${c.path}`}\n          ${c.message}\n`).join('');
}

/** Runs the CLI and returns the exit code: 0 success, 1 checks failed, 2 usage or file error. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  const print = (text: string): void => {
    io.stdout(safeText(text));
  };
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === '-h' || command === '--help' || command === 'help') {
      io.stdout(HELP);
      return command === undefined ? 2 : 0;
    }
    if (command === '-V' || command === '--version') {
      io.stdout(`${VERSION}\n`);
      return 0;
    }
    const o = parseArgs(rest);
    if (o.format === 'github' && command !== 'validate') throw new CliError('--format github is available for validate only.');
    const limits: Partial<Limits> = { maxInputBytes: o.maxInputBytes, checkBudget: o.checkBudget };
    const common = {
      commodity: o.commodity,
      variant: o.variant,
      format: o.inputFormat,
      maxBytes: o.maxBytes,
      maxProducers: o.maxProducers,
      checkBudget: o.checkBudget,
      limits,
      country: o.country,
      stripUnknownProperties: o.stripUnknownProperties,
      simplifyCollinear: o.simplifyCollinear,
      cutAntimeridian: o.cutAntimeridian,
      removeDuplicates: o.removeDuplicates,
    };
    const readOne = async (): Promise<{ path: string; bytes: Uint8Array }> => {
      if (o.files.length !== 1) throw new CliError(`${command} takes exactly one input file.`);
      const path = o.files[0] as string;
      return { path, bytes: await io.readFile(path, o.maxInputBytes) };
    };
    const writeOut = async (input: string, content: string): Promise<void> => {
      if (o.out === undefined) throw new CliError(`${command} needs --out <file>.`);
      if (await io.sameFile(input, o.out)) throw new CliError('--out must not be the input file.');
      await io.writeFile(o.out, content, o.force);
    };

    switch (command) {
      case 'rules': {
        if (o.format === 'json') io.stdout(`${JSON.stringify({ generator: GENERATOR, rules: RULES }, null, 2)}\n`);
        else {
          for (const r of RULES) {
            print(`${r.id}  [${r.status}, ${r.severity}]  ${r.title}\n`);
            for (const s of r.sources) print(`    ${s.cite}  ${s.url}\n`);
            if (r.fix !== null) print(`    fix: ${r.fix}\n`);
          }
          print(`\n${FOOTER}\n`);
        }
        return 0;
      }
      case 'validate': {
        let files = o.files;
        let base = '';
        if (o.root !== undefined || o.glob !== undefined) {
          if (o.root === undefined || o.glob === undefined) throw new CliError('--root and --glob go together.');
          if (files.length > 0) throw new CliError('Give either files or --root with --glob, not both.');
          files = await io.listFiles(o.root, o.glob, 10_000);
          base = o.root;
          if (files.length === 0) throw new CliError(`No files match ${JSON.stringify(o.glob)} under ${JSON.stringify(o.root)}.`, 1);
        }
        if (files.length === 0) throw new CliError('validate needs at least one file.');
        const results: { file: string; report: Report }[] = [];
        // Files found under --root are shown relative to the current directory, so
        // GitHub annotations point at the right file when the root is a subdirectory.
        const prefix = base === '' ? '' : base.replace(/\/+$/, '');
        for (const file of files) {
          const path = base === '' ? file : io.joinPath(base, file);
          const shown = prefix === '' || prefix === '.' ? file : `${prefix}/${file}`;
          const bytes = await io.readFile(path, o.maxInputBytes);
          results.push({ file: shown, report: validate(bytes, { ...common, name: file }) });
        }
        const anyFailed = results.some((r) => failed(r.report, o.failOn));
        if (o.format === 'json') {
          io.stdout(`${JSON.stringify({ generator: GENERATOR, ok: !anyFailed, files: results }, null, 2)}\n`);
        } else if (o.format === 'github') {
          for (const { file, report } of results) {
            for (const i of report.issues) {
              if (i.severity === 'info') continue;
              const level = i.severity === 'error' ? 'error' : 'warning';
              const props = [`file=${githubEscape(file, true)}`, i.line === null ? null : `line=${i.line}`, `title=${githubEscape(`Plotline ${i.rule}`, true)}`].filter((x) => x !== null).join(',');
              io.stdout(`::${level} ${props}::${githubEscape(`${i.message}${i.path === '' ? '' : ` (${i.path})`}`, false)}\n`);
            }
            io.stdout(`${githubEscape(`${file}: ${counts(report)}`, false)}\n`);
          }
          io.stdout(`${FOOTER}\n`);
        } else {
          for (const { file, report } of results) {
            print(`${file}: ${report.ok ? 'OK' : 'FAILED'} – ${counts(report)}\n`);
            for (const i of report.issues) print(formatIssue(i));
            for (const n of report.notes) print(`  ${n}\n`);
            print(formatSummary(report));
          }
          print(`${FOOTER}\n`);
        }
        return anyFailed ? 1 : 0;
      }
      case 'fix': {
        const { path, bytes } = await readOne();
        const r = fix(bytes, { ...common, name: path });
        if (r.output === null || r.after === null) {
          if (o.format === 'json') io.stdout(`${JSON.stringify({ generator: GENERATOR, file: path, written: null, changes: [], before: r.before, after: null }, null, 2)}\n`);
          else {
            print(`${path}: cannot be repaired – ${counts(r.before)}\n`);
            for (const i of r.before.issues) print(formatIssue(i));
            print(`${FOOTER}\n`);
          }
          return 1;
        }
        await writeOut(path, r.output);
        if (o.format === 'json') {
          io.stdout(`${JSON.stringify({ generator: GENERATOR, file: path, written: o.out, changes: r.changes, before: r.before, after: r.after }, null, 2)}\n`);
        } else {
          print(`${path} → ${o.out ?? ''}: ${r.changes.length} change(s)\n`);
          print(formatChanges(r.changes));
          print(`Result: ${r.after.ok ? 'OK' : 'still FAILED'} – ${counts(r.after)}\n`);
          for (const i of r.after.issues) print(formatIssue(i));
          print(formatSummary(r.after));
          print(`${FOOTER}\n`);
        }
        return failed(r.after, o.failOn) ? 1 : 0;
      }
      case 'stats': {
        const { path, bytes } = await readOne();
        const r = validate(bytes, { ...common, name: path });
        if (o.format === 'json') {
          io.stdout(`${JSON.stringify({ generator: GENERATOR, file: path, format: r.format, bytes: r.bytes, summary: r.summary, plots: r.plots }, null, 2)}\n`);
        } else {
          print(`${path}\n`);
          print(formatSummary(r));
          const areas = r.plots.filter((p) => p.hectares !== null).map((p) => p.hectares as number);
          if (areas.length > 0) {
            const sorted = [...areas].sort((a, b) => a - b);
            const median = sorted.length % 2 === 1 ? (sorted[(sorted.length - 1) / 2] as number) : ((sorted[sorted.length / 2 - 1] as number) + (sorted[sorted.length / 2] as number)) / 2;
            print(`  area per plot: smallest ${(sorted[0] as number).toFixed(4)} ha, median ${median.toFixed(4)} ha, largest ${(sorted[sorted.length - 1] as number).toFixed(4)} ha\n`);
            print(`  plots of more than 4 ha: ${areas.filter((a) => a > 4).length}; up to 4 ha: ${areas.filter((a) => a <= 4).length}\n`);
          }
          print(`  ${counts(r)} (run plotline validate for details)\n`);
          print(`${FOOTER}\n`);
        }
        return 0;
      }
      case 'split': {
        const { path, bytes } = await readOne();
        if (o.outDir === undefined) throw new CliError('split needs --out-dir <dir>.');
        const r = split(bytes, { ...common, name: path, repair: o.repair ?? true });
        if (r.parts.length === 0) {
          if (o.format === 'json') io.stdout(`${JSON.stringify({ generator: GENERATOR, source: path, parts: [], before: r.before }, null, 2)}\n`);
          else {
            print(`${path}: nothing to split – ${counts(r.before)}\n`);
            for (const i of r.before.issues) print(formatIssue(i));
            print(`${FOOTER}\n`);
          }
          return 1;
        }
        await io.makeDir(o.outDir);
        for (const p of r.parts) await io.writeFile(io.joinPath(o.outDir, p.name), p.text, o.force);
        const manifest = { generator: GENERATOR, source: path, maxBytes: o.maxBytes, maxProducers: o.maxProducers, parts: r.parts.map((p) => ({ name: p.name, bytes: p.bytes, plots: p.plots, producers: p.producers })), oversized: r.oversized, spreadProducers: r.spreadProducers, changes: r.changes };
        await io.writeFile(io.joinPath(o.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, o.force);
        if (o.format === 'json') io.stdout(`${JSON.stringify(manifest, null, 2)}\n`);
        else {
          print(`${path} → ${o.outDir}: ${r.parts.length} part(s)\n`);
          for (const p of r.parts) print(`  ${p.name}: ${p.plots} plot(s), ${p.producers} producer(s), ${p.bytes} bytes\n`);
          if (r.changes.length > 0) print(`  ${r.changes.length} repair(s) applied before splitting (see manifest.json).\n`);
          if (r.spreadProducers > 0) print(`  ${r.spreadProducers} producer(s) did not fit in one part and were spread over several.\n`);
          if (r.oversized.length > 0) print(`  ${r.oversized.length} plot(s) are larger than --max-bytes on their own and could not be made to fit.\n`);
          print('  Submit each part with its own due diligence statement; the statements can then be grouped (Implementing Regulation (EU) 2024/3084, Article 8a).\n');
          print(`${FOOTER}\n`);
        }
        return r.oversized.length > 0 ? 1 : 0;
      }
      case 'convert': {
        const { path, bytes } = await readOne();
        const r = convert(bytes, { ...common, name: path, repair: o.repair ?? false });
        if (r.output === null) {
          if (o.format === 'json') io.stdout(`${JSON.stringify({ generator: GENERATOR, file: path, written: null, format: r.before.format, before: r.before }, null, 2)}\n`);
          else {
            print(`${path}: cannot be converted – ${counts(r.before)}\n`);
            for (const i of r.before.issues) print(formatIssue(i));
            print(`${FOOTER}\n`);
          }
          return 1;
        }
        let content = r.output;
        if (o.to === 'dds-producers') {
          const read = readPlots(r.output, { format: 'geojson' });
          content = `${JSON.stringify({ generator: GENERATOR, producers: toDdsProducers(read.plots) }, null, 2)}\n`;
        }
        await writeOut(path, content);
        if (o.format === 'json') io.stdout(`${JSON.stringify({ generator: GENERATOR, file: path, written: o.out, format: r.before.format, changes: r.changes, notes: r.before.notes }, null, 2)}\n`);
        else {
          print(`${path} (${r.before.format}) → ${o.out ?? ''}\n`);
          for (const n of r.before.notes) print(`  ${n}\n`);
          if (r.changes.length > 0) print(formatChanges(r.changes));
          print(`  The input has ${counts(r.before)}; run plotline validate on the output.\n`);
          print(`${FOOTER}\n`);
        }
        return 0;
      }
      default:
        throw new CliError(`Unknown command ${JSON.stringify(command.slice(0, 40))}. See plotline --help.`);
    }
  } catch (e) {
    if (e instanceof CliError) {
      io.stderr(`plotline: ${safeText(e.message)}\n`);
      return e.exitCode;
    }
    if (e instanceof RangeError) {
      io.stderr(`plotline: ${safeText(e.message)}\n`);
      return 2;
    }
    io.stderr('plotline: unexpected internal error. Please report it with a minimal example (without real farm data).\n');
    return 2;
  }
}
