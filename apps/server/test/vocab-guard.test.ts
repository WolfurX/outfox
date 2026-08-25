import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Retired-vocabulary guard. The pre-Solana dev repo used frozen mechanics names
// ($VIG, MEMPOOL); the 2026-08 migration unified everything under the Outfox
// vocabulary (ALPHA, Outfox). The retired names survive only inside sim/ result
// records and archived docs. This guard keeps them from re-entering living code.

const ROOT = join(__dirname, '..', '..', '..');
const GUARDED = ['apps/web/src', 'apps/server/src', 'packages/shared/src', 'sim'];
// case-sensitive, word-bounded: "VIG" the token name, never "navigate"
const FORBIDDEN = /\bVIG\b|\$VIG|\bMEMPOOL\b/;
// sim/ result records (scorecards, probes, audit logs) are immutable history and keep
// the old names; only live sim code and the README are guarded.
const RECORD = /sim[\\/].*\.(txt|json)$|sim[\\/](AUDIT-2|REDTEAM|M4-CONTRACT-LOOP)\.md$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '.venv' || name === '__pycache__') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|css|html|py|json|md)$/.test(name)) out.push(p);
  }
  return out;
}

describe('retired-vocabulary guard', () => {
  it('living code never contains the retired names (VIG / MEMPOOL)', () => {
    const leaks: string[] = [];
    for (const dir of GUARDED) {
      for (const file of walk(join(ROOT, dir))) {
        if (RECORD.test(relative(ROOT, file))) continue;
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (FORBIDDEN.test(line)) leaks.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(leaks, `retired vocabulary leaked into living code:\n${leaks.join('\n')}`).toEqual([]);
  });
});
