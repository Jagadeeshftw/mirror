import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Monad charges the full gas limit, so every limit must come from Monad's own eth_estimateGas (or a simulation
 * on Monad) plus headroom. A hard-coded limit, a third-party quote or forge's Ethereum-priced simulation once
 * cost a real failed mainnet transaction. This scan fails on any hard-coded limit in code that sends
 * transactions, including comments that recommend one.
 */
const engine = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(engine, '..');

const ROOTS = ['engine/src', 'engine/scripts', 'scripts', 'contracts/script'];
const EXTENSIONS = /\.(ts|mts|cts|js|mjs|cjs|sol|sh|json)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'cache', 'broadcast', '.e2e']);

/** The only places allowed to contain these patterns: the estimator module and test fixtures. */
const ALLOW = [/^engine\/src\/chain\/sender\.ts$/, /^engine\/test\//, /\.test\.ts$/, /^engine\/test\/fixtures\//];

const PATTERNS: Array<[string, RegExp]> = [
  ['gas: <number>', /\bgas\s*:\s*[\d_]+n?\b/],
  ['gasLimit: <number>', /\bgas_?[Ll]imit\s*[:=]\s*[\d_]+n?\b/],
  ['{gas: <number>} call option', /\{\s*gas\s*:\s*[\d_]/],
  ['--gas-limit', /--gas-limit\b/],
  ['--gas-estimate-multiplier', /--gas-estimate-multiplier\b/],
];

function* files(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p);
    else if (EXTENSIONS.test(e) && !/lock\.json$/.test(e)) yield p;
  }
}

function scan(): { hits: string[]; scanned: string[] } {
  const hits: string[] = [];
  const scanned: string[] = [];
  for (const root of ROOTS) {
    for (const f of files(join(repo, root))) {
      const rel = relative(repo, f).split(sep).join('/');
      if (ALLOW.some((a) => a.test(rel))) continue;
      scanned.push(rel);
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const [name, re] of PATTERNS) if (re.test(line)) hits.push(`${rel}:${i + 1}: ${name}: ${line.trim()}`);
        });
    }
  }
  return { hits, scanned };
}

describe('no hard-coded gas limits (Monad charges the full limit)', () => {
  it('finds none in engine/src, engine/scripts, scripts/ and contracts/script', () => {
    const { hits, scanned } = scan();
    // Not a vacuous pass: every root was actually read.
    for (const must of ['engine/src/services/copier.ts', 'engine/src/services/stops.ts', 'engine/scripts/e2e-fork.ts', 'contracts/script/Deploy.s.sol', 'scripts/measure-monad.mjs']) expect(scanned).toContain(must);
    expect(hits).toEqual([]);
  });

  it('the patterns catch the forms that matter', () => {
    const bad = ['gas: 21_000n,', 'gas: 500000', 'gasLimit: 3_000_000n', 'const gas_limit = 9000', 'foo{gas: 100000}(x)', 'forge script X --gas-limit 3000000', '--gas-estimate-multiplier 120'];
    for (const b of bad) expect(PATTERNS.some(([, re]) => re.test(b)), b).toBe(true);
    const good = ['gas: await this.estimate(req),', 'gas,', 'gasLimit: res.gasLimit.toString()', 'gas: receipt.gasUsed * 2n', 'gasProfile: \'book\''];
    for (const g of good) expect(PATTERNS.some(([, re]) => re.test(g)), g).toBe(false);
  });
});
