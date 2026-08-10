// ============================================================================
// CORE — shared primitives used across every module, mirrors 01-core-types.md
// ============================================================================

let _idCounter = 1;
export function newId(prefix) { return `${prefix}_${(_idCounter++).toString(36)}`; }

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand(rng, lo = 0, hi = 1) { return lo + rng() * (hi - lo); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
export function choiceWeighted(rng, entries) {
  // entries: [[item, weight], ...]
  const total = entries.reduce((s, e) => s + e[1], 0);
  let r = rng() * total;
  for (const [item, w] of entries) { r -= w; if (r <= 0) return item; }
  return entries[entries.length - 1][0];
}

// Deterministic seeded RNG (mulberry32) so a given seed always regenerates the same world.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- StandingValue (Loyalty / Sympathy / Opinion) -------------------------
export function newStanding(baseline = 0) {
  return { structuralBaseline: baseline, modifiers: [] };
}
export function decayFactor(m, now) {
  if (m.decayHalfLifeTicks === Infinity) return 1;
  const dt = now - m.appliedAtTick;
  return Math.pow(0.5, dt / m.decayHalfLifeTicks);
}
export function currentStanding(sv, now) {
  const decayed = sv.modifiers.reduce((sum, m) => sum + m.value * decayFactor(m, now), 0);
  return clamp(sv.structuralBaseline + decayed, -1, 1);
}
export function addModifier(sv, mod) {
  sv.modifiers.push(mod);
  // prune negligible
  sv.modifiers = sv.modifiers.filter(m => Math.abs(m.value) > 0.001 || m.decayHalfLifeTicks === Infinity);
  return sv;
}

// ---- HysteresisGate ---------------------------------------------------------
export function newGate(spawnThreshold, despawnThreshold, sustainTicks) {
  return { spawnThreshold, despawnThreshold, sustainTicks, state: 'inactive', belowSinceTick: null };
}
export function updateGate(gate, metric, now) {
  if (gate.state === 'inactive') {
    if (metric >= gate.spawnThreshold) return { ...gate, state: 'active', belowSinceTick: null };
    return gate;
  }
  if (metric >= gate.despawnThreshold) return { ...gate, belowSinceTick: null };
  if (gate.belowSinceTick === null) return { ...gate, belowSinceTick: now };
  if (now - gate.belowSinceTick >= gate.sustainTicks) return { ...gate, state: 'inactive', belowSinceTick: null };
  return gate;
}

// ---- DistanceDecay ------------------------------------------------------------
export function distanceDecay({ baseValue, distance, decayRate, terrainPenalty = 1 }) {
  return baseValue * Math.exp(-decayRate * distance) * terrainPenalty;
}
