#!/usr/bin/env node
// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from 'node:path';
import process from 'node:process';
import { listFiles, makeDir, readFileLimited, sameFile, writeFileSafe } from './node-io.js';
import { run } from './run.js';

// A closed pipe (for example `plotline validate x | head`) ends output quietly.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
  throw error;
});

const code = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readFile: readFileLimited,
  writeFile: writeFileSafe,
  makeDir,
  sameFile,
  listFiles,
  joinPath: join,
});
process.exitCode = code;
