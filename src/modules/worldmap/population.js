// worldmap/population.js — natural growth / decrease (World Map "Population dynamics": derived from the cell's need satisfaction, bounded by max_population_density).
//   delta(cell) = population x pop.growth (constant, 0.01) x f(cell)        f in [-1, +1]
//   f = shortage of subsistence  (subsistence satisfaction - 1, in [-1, 0])      while subsistence is not fully met
//     = abundance of comfort     (comfort satisfaction, in [0, +1])              once it is
// (spec decision: the kb gives the shape — growth from subsistence/comfort satisfaction — not the formula; epidemic burden joins here when Exogenous shocks exist.)
// The change is mirrored into the province stock and Nation presence of the cell's Region (spread by the Nation's presence share, capped by each province's density
// ceiling when growing), so Region splits (World Map Rule 7) and the presence/population invariants keep holding. Runs at step 8, BEFORE the Region pass.
const sum = a => a.reduce((s, x) => s + x, 0)
export const growthFactor = c => { const s = c.satisfaction ?? {}, sub = s.subsistence ?? 1; return sub < 1 ? sub - 1 : (s.comfort ?? 0) }
const ceiling = p => (p.maxPopulationDensity !== undefined && p.maxArea !== undefined ? p.maxPopulationDensity * p.maxArea : Infinity)

/** Spread `amount` over provinces by weight, each capped; returns the allocation {p: a} and the total placed. */
function waterFill(amount, ps, weight, room) {
  const out = Object.fromEntries(ps.map(p => [p, 0])); let left = amount, open = ps.filter(p => weight(p) > 0 && room(p) > 1e-9)
  while (left > 1e-9 && open.length) { const W = sum(open.map(weight)); let used = 0
    for (const p of open) { const give = Math.min(left * weight(p) / W, room(p) - out[p]); out[p] += give; used += give }
    left -= used; open = open.filter(p => room(p) - out[p] > 1e-9); if (used <= 1e-12) break }
  return { alloc: out, placed: amount - left } }

export function stepPopulation(ctx) {
  const g = ctx.T('pop.growth'); if (!g) return
  const W = ctx.state.world, P = W.provinces, pres = (ctx.state.nations.presence ??= {})
  for (const key of Object.keys(ctx.state.polity.cells).sort()) {
    const c = ctx.state.polity.cells[key], f = growthFactor(c); if (!f || !(c.population > 0)) continue
    const delta = c.population * g * f, ps = (ctx.derive.worldmap.regionProvinces?.(c.region) ?? []).filter(p => P[p] && P[p].habitability !== 'Wasteland')
    const pr = p => pres[p]?.[c.nation] ?? 0; let applied
    if (!ps.length) applied = delta                                                         // no province data (bare test worlds): the cell alone
    else if (delta > 0) {
      const tot = sum(ps.map(pr)), { alloc, placed } = waterFill(delta, ps, p => (tot > 0 ? pr(p) : 1), p => ceiling(P[p]) - P[p].population)
      for (const p of ps) if (alloc[p]) { (pres[p] ??= {})[c.nation] = pr(p) + alloc[p]; P[p].population += alloc[p] }
      applied = placed }
    else {
      const tot = sum(ps.map(pr)), { alloc, placed } = tot > 0 ? waterFill(-delta, ps, pr, pr) : { alloc: {}, placed: -delta }
      for (const p of ps) if (alloc[p]) { pres[p][c.nation] = pr(p) - alloc[p]; P[p].population = Math.max(0, P[p].population - alloc[p]) }
      applied = -placed }
    if (!applied) continue
    const phi = (c.population + applied) / c.population
    for (const pool of Object.keys(c.labour)) { const com = c.labourCommitted?.[pool] ?? 0, free = Math.max(0, c.labour[pool] - com); c.labour[pool] = com + free * phi }   // retinue/armies neither breed nor starve; the free labour does
    c.population += applied }
  ctx.bump?.() }
