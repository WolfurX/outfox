import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// The server process holds the voucher signing key, so its import graph stays small.
// The Meteora SDK (and the Anchor, spl-token and bn.js packages it brings) is a dev
// dependency for scripts/launch.ts and tests only; chain/launch.ts decodes what it needs
// by offset. This guard keeps everything the running server loads (apps/server/src and
// packages/shared/src) on the declared runtime dependencies, and keeps the dev tree off a
// production install.

const ROOT = join(__dirname, '..', '..', '..');
const LOADED = ['apps/server/src', 'packages/shared/src'];
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const RUNTIME = new Set(Object.keys(pkg.dependencies));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs|cjs)$/.test(name)) out.push(p);
  }
  return out;
}
const files = LOADED.flatMap((d) => walk(join(ROOT, d)));
const lines = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').map((text, i) => ({ at: `${relative(ROOT, f)}:${i + 1}`, text })));

describe('launch dependency guard', () => {
  it('every module the server loads is relative, a node builtin, or a declared runtime dependency', () => {
    const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\b(?:require|requireRuntime)\s*\(\s*|^\s*import\s+)(['"`])([^'"`]+)\1/g;
    const leaks: string[] = [];
    for (const { at, text } of lines) {
      for (const m of text.matchAll(SPECIFIER)) {
        const spec = m[2];
        if (spec.startsWith('.')) {
          if (/(^|\/)scripts\//.test(spec)) leaks.push(`${at}: reaches into scripts/: ${spec}`);
          continue;
        }
        if (spec.startsWith('node:')) continue;
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!RUNTIME.has(name)) leaks.push(`${at}: ${spec} is not a runtime dependency`);
      }
      // a specifier that is not a plain string literal cannot be checked, so it is not allowed
      if (/\bimport\s*\(\s*(?!['"`])/.test(text) || /\b(?:require|requireRuntime)\s*\(\s*(?!['"`])/.test(text) || /\$\{/.test(text.match(SPECIFIER)?.join('') ?? '')) {
        leaks.push(`${at}: dynamic module specifier: ${text.trim()}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('the scripts-only packages are not named anywhere in what the server loads', () => {
    const FORBIDDEN = /@meteora-ag\/|@coral-xyz\/|@solana\/spl-token|bigint-buffer|['"`]bn\.js['"`/]/;
    expect(lines.filter(({ text }) => FORBIDDEN.test(text)).map(({ at, text }) => `${at}: ${text.trim()}`)).toEqual([]);
  });

  it('they are dev dependencies, pinned exactly; the server runs without dev dependencies', () => {
    for (const name of ['@meteora-ag/dynamic-bonding-curve-sdk', '@solana/spl-token', 'bn.js']) {
      expect(pkg.dependencies[name], name).toBeUndefined();
      expect(pkg.devDependencies[name], name).toMatch(/^\d+\.\d+\.\d+$/);
    }
    // the box installs with --omit=dev (deploy/README.md), so the runner must be a dependency
    expect(pkg.dependencies.tsx).toBeDefined();
    expect(pkg.devDependencies.tsx).toBeUndefined();
  });
});
