// economics/teaching.js — Teaching: the ONLY pool conversion (economics__kb; economics_polity__spec §5). Moves a cell's ACTUAL labour toward its Estate Labor Profile
// (a target only). Slow, target-pool-specific, no direct conversion. The Nation's pool affinity biases conversion INTO a pool. Permanent loss: a pool with zero labour
// country-wide cannot be trained back unless teachers are imported (LaborMigrationBan gates). Directed Teaching (education propaganda) is not available for retraining.
import { countryOfKey } from '../polity/cellstate.js'
/** Profile weights are shares of the cell's headcount (as seeded by the Estate's labourShare); normalisation is open in the kb. */
export const targetLabour = c => Object.fromEntries(Object.entries(c.laborProfile ?? {}).map(([p, w]) => [p, w * c.population]))
export function extinctPools(ctx, country) {
  const sum = {}; for (const [k, c] of Object.entries(ctx.state.polity.cells)) if (countryOfKey(ctx, k) === country) for (const [p, v] of Object.entries(c.labour)) sum[p] = (sum[p] ?? 0) + v
  return new Set(Object.keys(ctx.ruleset.pools).filter(p => !(sum[p] > 0))) }
export function teachCell(ctx, key, extinct = extinctPools(ctx, countryOfKey(ctx, key))) {
  const c = ctx.state.polity.cells[key], free = p => Math.max(0, (c.labour[p] ?? 0) - (c.labourCommitted?.[p] ?? 0)), aff = ctx.state.nations.affinity?.[c.nation] ?? {}
  c.flow = { ...(c.flow ?? {}), teaching: 0 }
  const teachers = Math.max(0, free('Teaching') - (ctx.derive.polity.directedShare?.(key, 'Teaching') ?? 0)); let capacity = teachers * ctx.T('teach.rate')
  const target = targetLabour(c), deficit = {}, surplus = {}
  for (const p of Object.keys(target)) { const d = target[p] - (c.labour[p] ?? 0); if (d > 1e-9 && !extinct.has(p)) deficit[p] = d }
  for (const p of Object.keys(c.labour)) { const s = Math.min(free(p), (c.labour[p] ?? 0) - (target[p] ?? 0)); if (s > 1e-9) surplus[p] = s }     // only uncommitted people above target can be retrained
  const totalSurplus = Object.values(surplus).reduce((a, b) => a + b, 0); capacity = Math.min(capacity, totalSurplus)
  if (capacity <= 1e-9 || !Object.keys(deficit).length) return 0
  const w = p => deficit[p] * (aff[p] ?? 1), gain = Object.fromEntries(Object.keys(deficit).map(p => [p, 0])); let left = capacity, open = Object.keys(deficit)
  while (left > 1e-9 && open.length) { const W = open.reduce((a, p) => a + w(p), 0); let used = 0                                              // water-filling over deficit x affinity, capped at each deficit
    for (const p of open) { const give = Math.min(left * w(p) / W, deficit[p] - gain[p]); gain[p] += give; used += give }
    left -= used; open = open.filter(p => deficit[p] - gain[p] > 1e-9); if (used <= 1e-12) break }
  const moved = Object.values(gain).reduce((a, b) => a + b, 0)
  for (const p of Object.keys(surplus)) c.labour[p] -= moved * surplus[p] / totalSurplus                                                       // taken pro rata from pools above target
  for (const p of Object.keys(gain)) c.labour[p] = (c.labour[p] ?? 0) + gain[p]
  c.flow.teaching = moved; return moved }
/** Economics step 3 (after the cascade). */
export function stepTeaching(ctx) {
  const ext = new Map(); let total = 0
  for (const key of Object.keys(ctx.state.polity.cells).sort()) { const country = countryOfKey(ctx, key); if (!ext.has(country)) ext.set(country, extinctPools(ctx, country)); total += teachCell(ctx, key, ext.get(country)) }
  return total }
