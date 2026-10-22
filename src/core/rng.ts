// Seeded PRNG (mulberry32). State is a single uint32 so it serializes into RunState.

export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  constructor(public state: number) {}

  /** Float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Pick by weight. weights[i] >= 0. */
  weighted<T>(arr: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i];
      if (r < 0) return arr[i];
    }
    return arr[arr.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

const SEED_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomSeedString(len = 6): string {
  let s = '';
  for (let i = 0; i < len; i++) s += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  return s;
}
