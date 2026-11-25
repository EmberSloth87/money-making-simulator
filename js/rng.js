/*
 * rng.js — Seeded pseudo-random number generator (mulberry32) plus helpers.
 *
 * The generator keeps its state on a plain object (the game state), so a saved
 * game resumes with exactly the same random sequence it would have had.
 * Works both in the browser (window.MMS.RNG) and in Node (module.exports).
 */
(function (global) {
  'use strict';
  const MMS = global.MMS || (global.MMS = {});

  /** Hash any string into a 32-bit unsigned seed. */
  function seedFromString(str) {
    str = String(str);
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  /**
   * Create an RNG bound to `holder.rngState` (a uint32 that is mutated on every draw).
   */
  function makeRng(holder) {
    if (typeof holder.rngState !== 'number') holder.rngState = (Math.random() * 4294967296) >>> 0;

    function next() {
      holder.rngState = (holder.rngState + 0x6D2B79F5) >>> 0;
      let t = holder.rngState;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    return {
      next,
      /** Uniform float in [a, b). */
      float(a, b) { return a + (b - a) * next(); },
      /** Uniform float within a [lo, hi] pair (or the number itself). */
      range(r) { return Array.isArray(r) ? r[0] + (r[1] - r[0]) * next() : r; },
      /** Uniform integer in [a, b] inclusive. */
      int(a, b) { return a + Math.floor((b - a + 1) * next()); },
      chance(p) { return next() < p; },
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      /** Pick an item with probability proportional to weightOf(item). */
      weighted(items, weightOf) {
        const ws = items.map(weightOf);
        const total = ws.reduce((a, b) => a + Math.max(0, b), 0);
        if (total <= 0) return items[0];
        let r = next() * total;
        for (let i = 0; i < items.length; i++) {
          r -= Math.max(0, ws[i]);
          if (r < 0) return items[i];
        }
        return items[items.length - 1];
      },
      /** Standard normal draw (Box–Muller). */
      normal() {
        let u = 0;
        while (u === 0) u = next();
        const v = next();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      }
    };
  }

  MMS.RNG = { makeRng, seedFromString };
  if (typeof module !== 'undefined' && module.exports) module.exports = MMS.RNG;
})(typeof window !== 'undefined' ? window : globalThis);
