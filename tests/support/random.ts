/**
 * Seeded pseudo-random numbers for searching tests. Every generator in this
 * directory takes a seed and yields the same case for the same seed, so a
 * failure prints its seed and is reproduced by running the test with it.
 *
 * The stream is a 32-bit xorshift (`xorshift32`) over a SplitMix-scrambled
 * seed: short, dependency-free and good enough to spread cases; it is not a
 * cryptographic source and not meant to be.
 */

export interface Random {
  /** The seed this stream started from. */
  readonly seed: number;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Uniform in [min, max). */
  float(min: number, max: number): number;
  /** `true` with probability `p` (default 0.5). */
  chance(p?: number): boolean;
  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** A new array with the elements in random order (Fisher-Yates); the input is left alone. */
  shuffle<T>(items: readonly T[]): T[];
  /** One entry chosen with probability proportional to its weight; weights of zero are never chosen. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
  /** `count` distinct elements of an array, in random order. */
  sample<T>(items: readonly T[], count: number): T[];
  /** A fresh stream whose seed derives from this one; use it to keep sub-generators independent of each other's draws. */
  fork(): Random;
}

/** Scramble a seed so that neighbouring seeds (1, 2, 3 …) give unrelated streams. */
function scramble(seed: number): number {
  let z = (seed >>> 0) + 0x9e3779b9;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z = (z ^ (z >>> 16)) >>> 0;
  return z === 0 ? 0x1234567 : z;
}

export function createRandom(seed: number): Random {
  if (!Number.isInteger(seed)) throw new Error(`seed must be an integer, got ${String(seed)}`);
  let state = scramble(seed);
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
  const int = (min: number, max: number): number => {
    if (max < min) throw new Error(`int: max ${max} below min ${min}`);
    return min + Math.floor(next() * (max - min + 1));
  };
  const random: Random = {
    seed,
    next,
    int,
    float: (min, max) => min + next() * (max - min),
    chance: (p = 0.5) => next() < p,
    pick: (items) => {
      if (!items.length) throw new Error("pick: empty array");
      return items[int(0, items.length - 1)];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    weighted: (entries) => {
      let total = 0;
      for (const [, w] of entries) {
        if (!(w >= 0)) throw new Error(`weighted: weight ${w} is negative or not a number`);
        total += w;
      }
      if (!(total > 0)) throw new Error("weighted: no entry has a positive weight");
      let r = next() * total;
      for (const [value, w] of entries) {
        if (w === 0) continue;
        r -= w;
        if (r < 0) return value;
      }
      // Rounding left `r` at zero: the last entry with weight.
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i][1] > 0) return entries[i][0];
      throw new Error("weighted: unreachable");
    },
    sample: (items, count) => random.shuffle(items).slice(0, Math.max(0, Math.min(count, items.length))),
    fork: () => createRandom(int(0, 2 ** 31 - 1)),
  };
  return random;
}

/**
 * The number of cases a searching test runs: `base` by default, fifty times as
 * many with `WISE_DEEP=1`, and fifty times a larger `WISE_DEEP` factor beyond that.
 */
export function caseCount(base: number): number {
  const raw = process.env.WISE_DEEP?.trim();
  if (!raw || raw === "0" || raw.toLowerCase() === "false") return base;
  const factor = Number(raw);
  return base * 50 * (Number.isFinite(factor) && factor > 1 ? Math.floor(factor) : 1);
}

/**
 * The seeds a searching test runs, `count` of them from a start seed: 1 by default,
 * `WISE_SEED` when set, so that `WISE_SEED=<seed>` replays a failing seed as the
 * first case of the run.
 */
export function seeds(count: number, start = firstSeed()): number[] {
  return Array.from({ length: count }, (_, i) => start + i);
}

function firstSeed(): number {
  const raw = process.env.WISE_SEED?.trim();
  const n = raw ? Number(raw) : 1;
  return Number.isInteger(n) ? n : 1;
}

/** The sentence a failing search prints before its assertion: the seed and the step it failed at. */
export function caseLabel(seed: number, detail?: string): string {
  return `seed ${seed}${detail ? ` (${detail})` : ""}; replay with WISE_SEED=${seed}`;
}
