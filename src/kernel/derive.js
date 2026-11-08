// kernel/derive.js — per-epoch memo for derived readouts. bump() at every step boundary.
export function makeMemo() {
  let cache = new Map()
  return {
    bump() { cache = new Map() },
    fn(name, f) { return (...args) => { const k = name + '|' + JSON.stringify(args); if (!cache.has(k)) cache.set(k, f(...args)); return cache.get(k) } },
  }
}
