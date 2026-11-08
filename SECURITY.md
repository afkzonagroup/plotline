# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:
<https://github.com/afkzonagroup/plotline/security/advisories/new>. Do not
open a public issue. If you cannot use GitHub, email info@afkzonagroup.lt.

Include the version, what you did, what happened, and a minimal example
**without real farm locations or producer names**. We aim to acknowledge
reports within five working days and to agree a disclosure date with you.

Supported versions: the latest release.

## Threat model

### Assets

- **Geolocation data**: plot boundaries and points, often with producer
  names. For smallholders this identifies a person's land: personal data.
- **Validation results**: operators rely on them before submitting a due
  diligence statement. A wrong "OK", or a repair that silently changes a
  plot, can lead to a rejected or incorrect statement.
- **The user's machine**: files the CLI reads and writes, the terminal, the
  CI runner that runs the GitHub Action.

### Actors

- The **operator's analyst** who runs Plotline (trusted, may make mistakes).
- A **hostile or careless data source**: suppliers, cooperatives and
  third-party tools produce the files. Assume any file can be crafted.
- A **hostile contributor** to a repository that the GitHub Action checks:
  can add files and choose their names and content.

### Trust boundaries

1. File content entering any reader (GeoJSON, KML, CSV), in every interface.
2. File names and paths given on the command line or found by `--glob`.
3. Output to the terminal and to GitHub workflow commands.
4. Files written by the CLI.
5. The offline page: a file dropped into a browser page.

### Threats and mitigations

| Threat | Mitigation | Test |
|---|---|---|
| Memory or CPU exhaustion by large, deep or numerous values | Byte limit checked before reading and decoding; iterative JSON and XML parsers (no recursion) with depth, value-count, string-length and number-length limits; feature and position limits; every limit has a hard maximum | `test/json.test.ts`, `test/hostile.test.ts`, `test/readers.test.ts` |
| Quadratic geometry checks (self-intersection, overlaps) on adversarial shapes | Sweep-line checks charged to a work budget; when it runs out, Plotline stops and reports `check-limit-reached` instead of hanging | `test/geometry.test.ts`, `test/hostile.test.ts` |
| XML entity expansion (billion laughs) and external entities (XXE) | Any `<!DOCTYPE` or other `<!` declaration is refused; only the five predefined entities and numeric references are decoded; no external resource is ever loaded | `test/readers.test.ts` |
| Prototype pollution through keys such as `__proto__` | Parsed objects are `Map`s; keys are only data; summaries use null-prototype objects | `test/json.test.ts`, `test/hostile.test.ts` |
| Ambiguous JSON (duplicate keys, unpaired surrogates, NaN, Infinity, numbers beyond double range) | Rejected as errors (RFC 8259 grammar, I-JSON) | `test/json.test.ts` |
| Invalid UTF-8 | Strict decoder; the file is refused | `test/readers.test.ts` |
| Silent data change by repairs | Repairs limited to changes that keep location and area; every change listed; idempotence tested; files in another coordinate system are never rewritten; unreadable features kept verbatim | `test/fix.test.ts` |
| Floating-point errors in geometry decisions | Integer micro-degree coordinates and exact orientation predicates (BigInt fallback in TypeScript, Python integers) | `test/geometry.test.ts` |
| Terminal escape injection through file names or property values | Control, C1, bidirectional and line-separator characters are escaped in all text output | `test/cli.test.ts` |
| GitHub workflow command injection through file names or messages | `%`, CR, LF (and `:` `,` in properties) are escaped as GitHub documents; annotations are built only from the current run's in-memory report; the action's `failed` output is derived from the exit code only | `test/cli.test.ts`, `test/action.test.ts` |
| Path tricks on output (overwrite input, follow links, clobber files) | Output may not be the input; files created with `O_EXCL` unless `--force`; `O_NOFOLLOW` on the target; mode 0600 files, 0700 directories; split part names are generated, never taken from input | `test/node-io.test.ts`, `test/cli.test.ts` |
| Reading devices or FIFOs | Only regular files are read; opened non-blocking | `test/node-io.test.ts` |
| `--glob` leaving the root or hanging | Relative patterns only, no `..`; symbolic links are not followed; `.git` and `node_modules` skipped; matching is polynomial (no regular expressions built from the pattern); file-count limit | `test/node-io.test.ts` |
| Stack traces or internals leaking | Unexpected errors produce a generic message | `test/cli.test.ts` |
| Offline page sending data out | Content Security Policy `default-src 'none'`, `connect-src 'none'`, `form-action 'none'`, script and style by SHA-256 hash only, `require-trusted-types-for 'script'` with no policies; links allow-listed to fixed official pages without query strings; no storage APIs | `test/app-build.test.ts`, `test/app-dom.test.ts` |
| Script injection in the offline page | The page is built with `createElement` and `textContent` only; attribute names are allow-listed; no HTML parsing sinks | `test/app-build.test.ts`, `test/source-hygiene.test.ts` |
| Supply chain | No runtime dependencies in either package; exact pinned development dependencies; lockfile; no install scripts; `npm audit` in CI; pinned action SHAs; Docker base image pinned by digest, runs as a non-root user | `test/source-hygiene.test.ts` |

### Data flows

Plotline reads the files you give it and writes only the files you name (or
the parts and manifest in the directory you name). The library, CLI, Python
package and offline page make no network connections and collect no
telemetry. The Docker image works with `--network none`. The GitHub Action
runs inside your workflow and sends nothing anywhere; annotations go to your
own repository's run.

## Running safely

- Run the Docker image with `--cap-drop=ALL --security-opt no-new-privileges
  --network none` and mount only the directory with your files.
- In GitHub Actions, give the job `permissions: contents: read` and check out
  with `persist-credentials: false`. Pin the action to a full commit SHA.
