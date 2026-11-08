// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

// The offline app's security controls: one self-contained file, a strict
// Content Security Policy that blocks all network access, no external
// resources, no HTML-parsing sinks. These tests fail if a control is removed.

import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JavaScript build script without type declarations
import { appCsp, buildApp } from '../scripts/build-app.mjs';

interface Built {
  html: string;
  script: string;
  style: string;
  scriptHash: string;
  styleHash: string;
}

let built: Built;

beforeAll(async () => {
  built = (await (buildApp as () => Promise<Built>)());
}, 30_000);

function csp(html: string): string {
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  if (m?.[1] === undefined) throw new Error('no CSP');
  return m[1];
}

describe('offline app build', () => {
  it('declares a strict Content Security Policy that blocks network access', () => {
    const policy = csp(built.html);
    expect(policy).toBe((appCsp as (a: string, b: string) => string)(built.scriptHash, built.styleHash));
    for (const directive of [
      "default-src 'none'",
      "connect-src 'none'",
      "img-src 'none'",
      "font-src 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "require-trusted-types-for 'script'",
      "trusted-types 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
  });

  it('allows exactly the inline script and stylesheet by hash', () => {
    const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('base64');
    expect(built.scriptHash).toBe(sha(built.script));
    expect(built.styleHash).toBe(sha(built.style));
    expect(built.html).toContain(`<script>${built.script}</script>`);
    expect(built.html).toContain(`<style>${built.style}</style>`);
    const outside = built.html.replace(built.script, '');
    expect(outside.match(/<script/g)).toHaveLength(1);
    expect(outside.match(/<style/g)).toHaveLength(1);
  });

  it('loads nothing from outside the file', () => {
    const markup = built.html.replace(built.script, '');
    expect(markup).not.toMatch(/<script[^>]+src=/i);
    expect(markup).not.toMatch(/<link/i);
    expect(markup).not.toMatch(/<img|<iframe|<object|<embed/i);
    expect(built.style).not.toMatch(/@import|url\(/i);
    // The script only creates links to fixed https pages and blob: downloads.
    for (const m of built.script.matchAll(/https?:\/\/[^\s"'`)<]+/g)) {
      // http://www.w3.org/2000/svg is the SVG namespace name, never fetched.
      expect(m[0]).toMatch(/^(https:\/\/(eur-lex\.europa\.eu\/|eudr\.webcloud\.ec\.europa\.eu\/tracesnt\/help\/|www\.rfc-editor\.org\/rfc\/|www\.iso\.org\/iso-3166-country-codes\.html$|www\.ogc\.org\/standards\/kml\/$|github\.com\/afkzonagroup\/plotline$|afkzonagroup\.lt$)|http:\/\/www\.w3\.org\/2000\/svg$|http:\/\/www\.opengis\.net\/def\/crs\/OGC\/1\.3\/CRS84$)/);
    }
  });

  it('contains no network APIs or HTML-parsing sinks', () => {
    for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'RTCPeerConnection', 'new Worker', 'window.open', 'location.href', 'location.assign', '.innerHTML', '.outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function', 'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'postMessage', 'serviceWorker', 'BroadcastChannel', 'SharedWorker', 'window.location']) {
      expect(built.script, forbidden).not.toContain(forbidden);
    }
  });

  it('sets no inline styles, which the policy would block', () => {
    expect(built.script).not.toMatch(/\.style\b|setAttribute\(\s*["']style|cssText/);
    expect(built.html.replace(built.script, '')).not.toMatch(/ style=/);
  });

  it('shows the privacy promise and the attribution', () => {
    expect(built.script).toContain('Your data stays on this computer.');
    expect(built.script).toContain('Not legal advice.');
    expect(built.script).toContain('Plotline by AFKzona Group');
    expect(built.script).toContain('https://afkzonagroup.lt');
    expect(built.html).toContain('<meta name="referrer" content="no-referrer">');
    // Links point only to fixed pages; DNS prefetching of them is still turned off.
    expect(built.html).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">');
  });
});
