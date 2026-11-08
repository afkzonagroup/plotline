// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * File access for the CLI. Reads are size-limited before the content is
 * loaded and accept only regular files. Writes create files with mode 0600
 * (plot files can identify farmers), never follow a symbolic link at the
 * target and never overwrite unless asked. Directory listing for --glob
 * stays inside the root, skips symbolic links and stops at a file limit.
 *
 * @packageDocumentation
 */

import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';

/** Error with a message that is safe to show to the user. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 2,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

const nonblock = (): number => (typeof constants.O_NONBLOCK === 'number' ? constants.O_NONBLOCK : 0);
const nofollow = (): number => (typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0);

function assertPath(path: string): void {
  if (path.length === 0 || path.length > 4096 || path.includes('\0')) throw new CliError('Invalid file path.');
}

/**
 * Reads a regular file of at most `maxBytes` bytes. The size is checked on
 * the open descriptor, and reading stops after `maxBytes + 1` bytes in case
 * the file grows while it is read.
 */
export async function readFileLimited(path: string, maxBytes: number): Promise<Uint8Array> {
  assertPath(path);
  let handle;
  try {
    // O_NONBLOCK: opening a FIFO or device must not hang; such files are then rejected.
    handle = await open(path, constants.O_RDONLY | nonblock());
  } catch {
    throw new CliError(`Cannot open ${JSON.stringify(path)} for reading.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new CliError(`${JSON.stringify(path)} is not a regular file.`);
    if (info.size > maxBytes) throw new CliError(`${JSON.stringify(path)} is ${info.size} bytes; the limit is ${maxBytes} bytes (--max-input-bytes).`, 1);
    const buffer = new Uint8Array(Math.min(info.size, maxBytes) + 1);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
      if (offset > maxBytes) throw new CliError(`${JSON.stringify(path)} is larger than the limit of ${maxBytes} bytes.`, 1);
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

/**
 * Writes a file with mode 0600. Without `force`, fails if the file exists.
 * With `force`, truncates an existing regular file but refuses a symbolic
 * link at the target (O_NOFOLLOW where the platform has it).
 */
export async function writeFileSafe(path: string, content: string, force: boolean): Promise<void> {
  assertPath(path);
  const flags = force
    ? constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | nofollow() | nonblock()
    : constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow() | nonblock();
  let handle;
  try {
    handle = await open(path, flags, 0o600);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 'EEXIST') throw new CliError(`${JSON.stringify(path)} exists. Use --force to overwrite it.`);
    if (code === 'ELOOP') throw new CliError(`${JSON.stringify(path)} is a symbolic link; Plotline does not write through links.`);
    throw new CliError(`Cannot write ${JSON.stringify(path)}.`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new CliError(`${JSON.stringify(path)} is not a regular file.`);
    await handle.writeFile(content, 'utf8');
  } finally {
    await handle.close();
  }
}

/** Creates a directory (and parents) with mode 0700 if it does not exist; refuses a symbolic link. */
export async function makeDir(path: string): Promise<void> {
  assertPath(path);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new CliError(`${JSON.stringify(path)} is a symbolic link; Plotline does not write through links.`);
    if (!info.isDirectory()) throw new CliError(`${JSON.stringify(path)} exists and is not a directory.`);
    return;
  } catch (error) {
    if (error instanceof CliError) throw error;
  }
  try {
    await mkdir(path, { recursive: true, mode: 0o700 });
  } catch {
    throw new CliError(`Cannot create directory ${JSON.stringify(path)}.`);
  }
}

/** True when two paths name the same existing file. */
export async function sameFile(a: string, b: string): Promise<boolean> {
  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
}

/** Matches one path segment against a pattern segment with "*" and "?" (two-pointer algorithm, no backtracking blow-up). */
function matchSegment(pattern: string, name: string): boolean {
  let p = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < name.length) {
    if (p < pattern.length && (pattern.charAt(p) === '?' || pattern.charAt(p) === name.charAt(n))) {
      p++;
      n++;
    } else if (p < pattern.length && pattern.charAt(p) === '*') {
      star = p++;
      mark = n;
    } else if (star >= 0) {
      p = star + 1;
      n = ++mark;
    } else return false;
  }
  while (p < pattern.length && pattern.charAt(p) === '*') p++;
  return p === pattern.length;
}

/**
 * Compiles a glob pattern over "/"-separated relative paths: a "**" segment
 * matches any number of directories, "*" any run of characters within one
 * name, "?" one character; everything else matches itself. Matching is
 * polynomial in the pattern and path length (dynamic programming over
 * segments), so no pattern can make it hang.
 */
export function compileGlob(pattern: string): (path: string) => boolean {
  if (pattern.length === 0 || pattern.length > 256) throw new CliError('The --glob pattern must have 1 to 256 characters.');
  if (pattern.startsWith('/') || pattern.split('/').includes('..')) throw new CliError('The --glob pattern must be relative and must not contain "..".');
  const parts = pattern.split('/');
  return (path: string): boolean => {
    const names = path.split('/');
    // can[i][j]: parts[i..] match names[j..]
    let next = new Array<boolean>(names.length + 1).fill(false);
    next[names.length] = true;
    for (let i = parts.length - 1; i >= 0; i--) {
      const cur = new Array<boolean>(names.length + 1).fill(false);
      const part = parts[i] as string;
      for (let j = names.length; j >= 0; j--) {
        if (part === '**') cur[j] = (next[j] ?? false) || (j < names.length && (cur[j + 1] ?? false));
        else cur[j] = j < names.length && matchSegment(part, names[j] as string) && (next[j + 1] ?? false);
      }
      next = cur;
    }
    return next[0] ?? false;
  };
}

/**
 * Refuses a root that is a symbolic link, or that passes through one below
 * the current directory: "plots" in a checked-out repository could point
 * anywhere on the machine. The current directory itself may be a link.
 */
async function assertRootNotLinked(root: string): Promise<void> {
  const cwd = process.cwd();
  const base = resolve(root);
  const rel = relative(cwd, base);
  const inside = rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  const steps: string[] = [];
  if (inside) {
    let p = cwd;
    for (const part of rel.split(sep)) steps.push((p = join(p, part)));
  } else if (rel !== '') steps.push(base);
  for (const step of steps) {
    const info = await lstat(step).catch(() => null);
    if (info === null) throw new CliError(`Cannot read directory ${JSON.stringify(root)}.`);
    if (info.isSymbolicLink()) throw new CliError(`${JSON.stringify(root)} is or passes through a symbolic link; Plotline does not follow links.`);
  }
}

/**
 * Lists regular files under `root` whose relative path matches `pattern`.
 * Does not follow symbolic links (the root included), skips ".git" and
 * "node_modules", descends at most 32 levels and stops with an error after
 * `maxFiles` matches.
 */
export async function listFiles(root: string, pattern: string, maxFiles: number): Promise<string[]> {
  assertPath(root);
  const matches = compileGlob(pattern);
  const base = resolve(root);
  await assertRootNotLinked(root);
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 32) return;
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      throw new CliError(`Cannot read directory ${JSON.stringify(relative(base, dir) || '.')}.`);
    }
    const entries: { name: string; dir: boolean; file: boolean }[] = [];
    for await (const e of handle) entries.push({ name: e.name, dir: e.isDirectory(), file: e.isFile() });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.dir) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        await walk(full, depth + 1);
      } else if (e.file) {
        const rel = relative(base, full).split(sep).join('/');
        if (matches(rel)) {
          out.push(rel);
          if (out.length > maxFiles) throw new CliError(`More than ${maxFiles} files match ${JSON.stringify(pattern)}.`);
        }
      }
    }
  };
  await walk(base, 0);
  return out;
}
