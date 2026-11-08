// economics/derive.js — pure readouts. Every number via ctx.T / ruleset.
import { parseCellKey } from '../../kernel/ids.js'
const sum = a => a.reduce((s, x) => s + x, 0), clamp01 = x => Math.min(1, Math.max(0, x))
const W = ctx => ctx.derive.worldmap

export const poolLabour = (ctx, key, pool) => {                    // production side of the dual-claim split
  const c = ctx.state.polity.cells[key]; return Math.max(0, (c.labour[pool] ?? 0) - (c.labourCommitted?.[pool] ?? 0)) }
export const labourAt = (ctx, p, pool) => {
  const region = ctx.state.world.regionSnapshot.assignment[p]; if (!region) return 0
  return sum(Object.keys(ctx.state.polity.cells).filter(k => parseCellKey(k).region === region).map(k => poolLabour(ctx, k, pool) * W(ctx).cellProvShare(k, p))) }
export function resourceYield(ctx, prov, good) {
  if (good === 'Timber') return ctx.T('yield.timberPerForest') * prov.forestation
  return ctx.T('yield.baseline') + (ctx.ruleset.terrain[prov.terrain]?.favor?.[good] ?? 0) }
export function extract(ctx, p, good) {                           // pool labour is SPLIT across the goods that pool can extract here: labour follows value (yield x base value)^theta
  const prov = ctx.state.world.provinces[p]; if (prov.habitability === 'Wasteland') return 0           // Wasteland yields nothing
  const pool = ctx.ruleset.goods[good].extractPool, y = g => resourceYield(ctx, prov, g) * (prov.resourceOverrides?.[g] ?? 1)
  const weight = g => (y(g) * ctx.ruleset.goods[g].baseValue * (ctx.scratch?.signal?.(p, g) ?? 1)) ** ctx.T('prod.theta')   // labour follows LIVE value (base x scarcity), derived this turn
  const rivals = Object.keys(ctx.ruleset.goods).filter(g => ctx.ruleset.goods[g].tier === 'raw' && ctx.ruleset.goods[g].extractPool === pool && y(g) > 0)
  const tw = sum(rivals.map(weight)); if (!tw) return 0
  const L = labourAt(ctx, p, pool) * weight(good) / tw
  return ctx.T('prod.k') * y(good) * L ** ctx.T('prod.alpha') }

// ---- trade zones: derived, never stored (hub = hill-climb on gravity)
const tie = p => { let h = 0; for (const ch of p) h = (h * 31 + ch.charCodeAt(0)) % 9973; return h / 9973 * 1e-6 }         // deterministic tie-break so hubs form on equal terrain
const rawGravity = (ctx, p) => (ctx.state.economy.lastOutput?.[p] ?? ctx.state.world.provinces[p].population) * (ctx.state.economy.tradeInfra[p] ?? 0)
/** gravity = own pull plus half of the neighbours' (smoothed so hubs merge into zones of several provinces); cached per ctx until reset at the end of step 3 */
export const gravity = (ctx, p) => { const c = (ctx._grav ??= {}); if (c[p] === undefined) c[p] = rawGravity(ctx, p) + 0.5 * sum(W(ctx).neighbors(p).map(q => rawGravity(ctx, q))) + tie(p); return c[p] }
export function hubOf(ctx, p) {                                       // hill-climb to the strongest neighbouring gravity (ties by id)
  const owner = ctx.state.world.provinces[p].owner; let cur = p
  for (let i = 0; i < 64; i++) {
    const nb = W(ctx).neighbors(cur).filter(q => ctx.state.world.provinces[q].owner === owner).sort()
    const best = nb.reduce((b, q) => (b === null || gravity(ctx, q) > gravity(ctx, b)) ? q : b, null)
    if (best === null || gravity(ctx, best) <= gravity(ctx, cur)) return cur
    cur = best
  }
  return cur
}
export const zoneOf = (ctx, p) => hubOf(ctx, p)
export const zones = ctx => { const z = {}; for (const p of Object.keys(ctx.state.world.provinces)) (z[zoneOf(ctx, p)] ??= []).push(p); return z }
export function cellZone(ctx, key) {                                // ASSUME: zone of the Region's province with the cell Nation's largest presence
  const { nation, region } = parseCellKey(key), ps = W(ctx).regionProvinces(region)
  return zoneOf(ctx, ps.reduce((b, p) => W(ctx).presence(p, nation) > W(ctx).presence(b, nation) ? p : b, ps[0])) }
export const zoneEdges = ctx => { const zs = zones(ctx), zi = {}, out = {}
  for (const [z, ps] of Object.entries(zs)) ps.forEach(p => zi[p] = z)
  for (const p of Object.keys(zi)) for (const q of W(ctx).neighbors(p)) if (zi[q] && zi[q] !== zi[p]) { const k = [zi[p], zi[q]].sort().join('~'); out[k] = [zi[p], zi[q]].sort() }
  return Object.values(out) }
export const throughputCap = (ctx, a, b) => ctx.T('zone.capBase') * Math.min(ctx.state.economy.tradeInfra[a] ?? 0, ctx.state.economy.tradeInfra[b] ?? 0) / 100

// ---- scarcity / prices
export const scarcity = (ctx, S, D) => Math.min(ctx.T('scar.max'), Math.max(ctx.T('scar.min'), (D + ctx.T('scar.eps')) / (S + ctx.T('scar.eps')))) ** ctx.T('scar.elasticity')
export const priceLevel = ctx => { const e = ctx.state.economy.coinage; return ((e.supply / e.lastVolume) / e.ratio0) ** ctx.T('money.kappa') }

// ---- administrative envelope: blend of committed pool units
export function produceCCO(ctx, country) {
  const out = { control: 0, coordination: 0, observation: 0 }
  for (const [key, c] of Object.entries(ctx.state.polity.cells)) {
    if (W(ctx).regionOwner(parseCellKey(key).region) !== country) continue
    for (const [pool, units] of Object.entries(c.labourCommitted ?? {})) { const env = ctx.ruleset.pools[pool]?.envelope; if (!env) continue
      const f = 1 - (ctx.state.admin.governments[country].poolUnmet?.[pool] ?? 0)
      for (const ax of Object.keys(out)) out[ax] += units * (env[ax] ?? 0) * f } }
  return out }

// ---- contribution (supplies Fairness)
export const poolScarcity = (ctx, pool) => { const cells = Object.values(ctx.state.polity.cells), tot = sum(cells.map(c => sum(Object.values(c.labour)))) || 1
  const mine = sum(cells.map(c => c.labour[pool] ?? 0)) || 1; return (tot / mine) ** ctx.T('contrib.beta') }
export const contribution = (ctx, key) => { const c = ctx.state.polity.cells[key]; const main = Object.entries(c.labour).sort((a, b) => b[1] - a[1])[0]?.[0]
  return (c.salesValueBase ?? 0) * (main ? poolScarcity(ctx, main) : 1) + (c.reliefDelivered ?? 0) + ctx.T('teach.value') * (c.flow?.teaching ?? 0) }   // retraining counts as a FLOW (Economics §5)

export const economicsDerive = { produceCCO, contribution, poolLabour, labourAt, extract, zoneOf, zones, cellZone, priceLevel }
