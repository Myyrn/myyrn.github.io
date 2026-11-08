// kernel/allocation.js — Allocation Dial: floors by priority (pass 1), surplus by ratio (pass 2).
import { cellsCovered } from './scope.js'
export const EPS = 1e-9

/** entry: {target: Scope|{kind:'group',cells}|{kind:'item',id}|{kind:'claim',claim}, floor, priority(1=highest),
 *          surplusWeight, cap?, mandatory?}   dial: {entries, sink?, reserve?} */
const unitsOf = (e, ctx) =>
  e.target.kind === 'item' ? [`item:${e.target.id}`]
  : e.target.kind === 'claim' ? [`claim:${e.target.claim}`]
  : cellsCovered(e.target, ctx)                       // PER CELL by default; aggregates/groups are bulk shorthand

export function resolveAllocation(dial, amount, ctx) {
  const rows = []
  dial.entries.forEach((e, i) => unitsOf(e, ctx).forEach(u => rows.push({ i, u, floor: e.floor, priority: e.priority,
    w: e.surplusWeight ?? 0, cap: e.cap, mandatory: !!e.mandatory, grant: 0 })))
  const reserve = dial.reserve ?? 0
  let remaining = amount, waterline = null
  const priorities = [...new Set(rows.map(r => r.priority))].sort((a, b) => a - b)
  for (const p of priorities) {                                   // pass 1
    for (const mand of [true, false]) {                           // upkeep may dip into reserve; discretionary may not
      const tier = rows.filter(r => r.priority === p && r.mandatory === mand)
      if (!tier.length) continue
      const pool = mand ? remaining : Math.max(0, remaining - reserve)
      const need = tier.reduce((s, r) => s + r.floor, 0)
      const k = need <= EPS ? 1 : Math.min(1, pool / need)       // shortfall truncates this (lowest) tier pro rata
      for (const r of tier) { r.grant = r.floor * k; remaining -= r.grant }
      if (k < 1 && !waterline) waterline = { priority: p, fraction: k }
    }
  }
  const canTake = r => r.w > 0 && !r.mandatory && (r.cap == null || r.grant < r.cap - EPS)
  let pool2 = Math.max(0, remaining - reserve), elig = rows.filter(canTake)   // pass 2: ratio, cap, overflow redistributes
  while (pool2 > EPS && elig.length) {
    const W = elig.reduce((s, r) => s + r.w, 0); let used = 0
    for (const r of elig) { const give = Math.min(pool2 * r.w / W, (r.cap ?? Infinity) - r.grant); r.grant += give; used += give }
    pool2 -= used; remaining -= used; elig = elig.filter(canTake)
    if (used <= EPS) break
  }
  return { rows, waterline, leftover: remaining, sink: dial.sink ?? null,
           headroom: amount - rows.reduce((s, r) => s + r.floor, 0) }
}
/** Additive stacking: Σ grants over every row hitting this unit. */
export const grantFor = (result, unit) => result.rows.filter(r => r.u === unit).reduce((s, r) => s + r.grant, 0)
