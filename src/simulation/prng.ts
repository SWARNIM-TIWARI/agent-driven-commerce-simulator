// src/simulation/prng.ts

/**
 * Deterministic seeded PRNG (mulberry32).
 * All simulation randomness flows through this — never Math.random().
 */

export type PRNG = () => number

/** DJB2 hash: converts any string seed to a 32-bit unsigned integer */
export function hashSeed(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i)
    h = h >>> 0
  }
  return h
}

/** mulberry32 — fast, high-quality 32-bit PRNG */
export function createPRNG(seed: string | number): PRNG {
  let s = typeof seed === 'string' ? hashSeed(seed) : (seed >>> 0)
  return function (): number {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), s | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
  }
}

/** Random integer in [min, max] inclusive */
export function randInt(prng: PRNG, min: number, max: number): number {
  return Math.floor(prng() * (max - min + 1)) + min
}

/** Random bool with probability p */
export function randBool(prng: PRNG, p: number): boolean {
  return prng() < p
}

/** Pick a random element from an array */
export function randPick<T>(prng: PRNG, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('Cannot pick from empty array')
  return arr[Math.floor(prng() * arr.length)]!
}

/**
 * Deterministic ID from a logical key.
 * Same key always produces same ID — critical for replay integrity.
 */
export function deterministicId(prefix: string, key: string): string {
  return `${prefix}_${hashSeed(key).toString(16).padStart(8, '0')}`
}

/** Simple sequential event ID — non-deterministic, excluded from replay comparison */
let _eventCounter = 0
export function nextEventId(runId: string): string {
  return `evt_${runId.slice(0, 6)}_${(++_eventCounter).toString().padStart(6, '0')}`
}

export function resetEventCounter(): void {
  _eventCounter = 0
}
