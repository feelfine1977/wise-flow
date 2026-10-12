/**
 * Seeded event schedules: random sequences of named operations with times on
 * a fake clock, and random interleavings of ordered sequences (replies that
 * arrive in any order). A schedule is what a model-based test feeds step by
 * step; the step index is part of the failure message.
 */
import { createRandom } from "./random";

export interface ScheduledEvent<T> {
  /** Position in the schedule, from 0. */
  step: number;
  /** Fake-clock time in milliseconds; never decreasing along the schedule. */
  at: number;
  event: T;
}

export interface ScheduleOptions {
  /** Number of events. */
  length: number;
  /** Smallest and largest gap between two consecutive events, in milliseconds. Defaults 0 and 100: equal times happen. */
  minGap?: number;
  maxGap?: number;
}

/** `length` events drawn by weight from the alphabet, with gaps between `minGap` and `maxGap`. */
export function schedule<T>(alphabet: readonly (readonly [T, number])[], seed: number, options: ScheduleOptions): ScheduledEvent<T>[] {
  const rng = createRandom(seed);
  const minGap = options.minGap ?? 0;
  const maxGap = options.maxGap ?? 100;
  if (maxGap < minGap || minGap < 0) throw new Error(`schedule: gaps must satisfy 0 <= minGap <= maxGap, got ${minGap} and ${maxGap}`);
  const out: ScheduledEvent<T>[] = [];
  let at = 0;
  for (let step = 0; step < options.length; step++) {
    if (step) at += rng.int(minGap, maxGap);
    out.push({ step, at, event: rng.weighted(alphabet) });
  }
  return out;
}

/**
 * A random merge of the sequences that keeps each sequence's own order: with
 * sequences `[a1, a2]` and `[b1]`, one of `a1 a2 b1`, `a1 b1 a2`, `b1 a1 a2`.
 * The chance of drawing from a sequence is proportional to what it has left.
 */
export function interleave<T>(seed: number, ...sequences: readonly (readonly T[])[]): T[] {
  const rng = createRandom(seed);
  const cursors = sequences.map(() => 0);
  const out: T[] = [];
  const total = sequences.reduce((sum, s) => sum + s.length, 0);
  while (out.length < total) {
    const i = rng.weighted(sequences.map((s, k) => [k, s.length - cursors[k]] as const));
    out.push(sequences[i][cursors[i]++]);
  }
  return out;
}
