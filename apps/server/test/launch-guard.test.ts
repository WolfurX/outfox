import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// The server process holds the voucher signing key, so its import graph stays small.
// The Meteora SDK (and the Anchor and spl-token packages it brings) is a dev dependency
// for scripts/ and tests only; chain/launch.ts decodes what it needs by offset. This
// guard keeps everything the running server loads (apps/server/src and
// packages/shared/src) on its declared runtime dependencies. The control that keeps the
// dev tree off the box is the install itself (`npm ci --omit=dev`, deploy/README.md);
// this test stops a careless import from making that install fail in production.

const ROOT = join(__dirname, '..', '..', '..');
const LOADED = ['apps/server/src', 'packages/shared/src'].map((d) => join(ROOT, d));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const RUNTIME = new Set(Object.keys(pkg.dependencies));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.[cm]?[jt]sx?$/.test(name)) out.push(p);
  }
  return out;
}
const files = LOADED.flatMap((d) => walk(d)).map((file) => ({ file, text: readFileSync(file, 'utf8') }));
const where = (file: string, text: string, index: number) =>
  `${relative(ROOT, file)}:${text.slice(0, index).split('\n').length}`;
const inside = (p: string) => LOADED.some((root) => p === root || p.startsWith(root + sep));

// every way a module specifier can be written as a literal; whitespace includes newlines
const SPECIFIER = /(?:\bfrom|\bimport\s*\(|\b(?:require|requireRuntime)\s*\(|(?:^|;)\s*import)\s*(['"`])([^'"`\n]*)\1/gm;

describe('launch dependency guard', () => {
  it('every module the server loads is inside its own tree, a node builtin, or a declared runtime dependency', () => {
    const leaks: string[] = [];
    for (const { file, text } of files) {
      for (const m of text.matchAll(SPECIFIER)) {
        const spec = m[2];
        const at = where(file, text, m.index);
        if (spec.includes('${')) { leaks.push(`${at}: computed specifier ${spec}`); continue; }
        if (spec.startsWith('.')) {
          // a relative import must stay inside what the server ships: not scripts/, test/,
          // node_modules or anything else reachable by walking up
          if (!inside(resolve(dirname(file), spec))) leaks.push(`${at}: leaves the server's tree: ${spec}`);
          continue;
        }
        if (spec.startsWith('node:')) continue;
        if (spec.split('/').includes('..')) { leaks.push(`${at}: path tricks in ${spec}`); continue; }
        const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (!RUNTIME.has(name)) leaks.push(`${at}: ${spec} is not a runtime dependency`);
      }
      // a specifier that is not a plain string literal cannot be checked, so it is not allowed
      for (const m of text.matchAll(/\bimport\s*\(\s*(?!['"`])|\b(?:require|requireRuntime)\s*\(\s*(?!['"`])/g)) {
        leaks.push(`${where(file, text, m.index)}: dynamic module specifier`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('createRequire exists in one place only, under the one checked name', () => {
    const users = files.filter(({ text }) => /\bcreateRequire\b/.test(text)).map(({ file }) => relative(ROOT, file));
    expect(users).toEqual(['apps/server/src/core/db.ts']);
    const db = files.find(({ file }) => file.endsWith(join('core', 'db.ts')))!.text;
    // the only binding made from createRequire is `requireRuntime`, which SPECIFIER checks
    expect([...db.matchAll(/(\w+)\s*=\s*createRequire\(/g)].map((m) => m[1])).toEqual(['requireRuntime']);
  });

  it('the scripts-only packages are not named anywhere in what the server loads', () => {
    const FORBIDDEN = /@meteora-ag\/|@coral-xyz\/|@solana\/spl-token|bigint-buffer/;
    expect(files.filter(({ text }) => FORBIDDEN.test(text)).map(({ file }) => relative(ROOT, file))).toEqual([]);
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
