// economics/step.js — step 3, fixed resolution order. Scratch state lives on ctx.scratch only.
import { parseCellKey } from '../../kernel/ids.js'
import { resolveState, covers } from '../../kernel/scope.js'
import { resolveAllocation } from '../../kernel/allocation.js'
import { scopeCtx } from '../administration/module.js'
import * as D from './derive.js'
const sum = a => a.reduce((s, x) => s + x, 0), clamp01 = x => Math.min(1, Math.max(0, x))
const cells = ctx => ctx.state.polity.cells, gov = (ctx, c) => ctx.state.admin.governments[c]
const W = ctx => ctx.derive.worldmap
const countryOfCell = (ctx, k) => W(ctx).regionOwner(parseCellKey(k).region)

// ---- warehouses (province-level stock, zone-pooled markets)
const wh = (ctx, p) => (ctx.state.economy.warehouses[p] ??= { capacity: null, stock: {} })      // capacity null = unlimited (JSON-safe)
const capOf = (ctx, p) => wh(ctx, p).capacity ?? Infinity
const zoneStock = (ctx, zs, z, g) => sum(zs[z].map(p => wh(ctx, p).stock[g] ?? 0))
function zoneTake(ctx, zs, z, g, q) {                                  // draw pro rata from the zone's warehouses
  const tot = zoneStock(ctx, zs, z, g); if (tot <= 0 || q <= 0) return 0; const take = Math.min(q, tot)
  for (const p of zs[z]) { const s = wh(ctx, p).stock; s[g] = (s[g] ?? 0) - take * (s[g] ?? 0) / tot }
  return take }
function zoneAdd(ctx, zs, z, g, q) {                                   // into the zone's province warehouses by capacity headroom (overflow spoils)
  const ps = zs[z], used = p => sum(Object.values(wh(ctx, p).stock)), room = p => Math.max(0, capOf(ctx, p) - used(p))
  const rooms = ps.map(room), tot = sum(rooms); let placed = 0
  if (tot === Infinity || ps.some(p => capOf(ctx, p) === Infinity)) { const p = ps[0]; wh(ctx, p).stock[g] = (wh(ctx, p).stock[g] ?? 0) + q; return q }
  ps.forEach((p, i) => { const put = tot ? Math.min(q * rooms[i] / tot, rooms[i]) : 0; wh(ctx, p).stock[g] = (wh(ctx, p).stock[g] ?? 0) + put; placed += put })
  return placed }

// ---- production: extraction then per-zone processing; outputs credited to cells
function production(ctx) {
  const zs = D.zones(ctx), prod = {}                                    // prod[cellKey][good] = qty produced this turn
  const credit = (key, g, q) => { if (q > 0) { prod[key] ??= {}; prod[key][g] = (prod[key][g] ?? 0) + q } }
  ctx.scratch.zs = zs; ctx.scratch.lastOutput = {}
  ctx.scratch.mil = {}; for (const r of ctx.derive.war?.upkeepBySource?.() ?? []) { const z = D.zoneOf(ctx, r.province); ((ctx.scratch.mil[z] ??= {})[r.good] = (ctx.scratch.mil[z][r.good] ?? 0) + r.qty) }   // military demand (War state, via derive)
  // derived demand: final consumption, propagated backward through recipes (net of stock); drives value added and caps runs
  const goodsDef = ctx.ruleset.goods, tiersDown = ['transport', 'heavy', 'light', 'semi']
  const need = {}, demand = {}                                                    // need[z][g] = net units still to be produced this turn
  for (const z of Object.keys(zs)) { const Dm = {}
    for (const k of Object.keys(cells(ctx))) if (D.cellZone(ctx, k) === z) { const c = cells(ctx)[k]
      for (const tier of ['subsistence', 'comfort', 'luxury']) for (const item of ctx.ruleset.consumption[tier] ?? []) { const g = [...item.any].sort((a, b) => zoneStock(ctx, zs, z, b) - zoneStock(ctx, zs, z, a))[0]; Dm[g] = (Dm[g] ?? 0) + item.perCapita * c.population } }
    for (const [g, q] of Object.entries(ctx.scratch.mil[z] ?? {})) Dm[g] = (Dm[g] ?? 0) + q
    need[z] = {}; demand[z] = Dm
    for (const tier of tiersDown) for (const [g, d] of Object.entries(goodsDef)) { if (d.tier !== tier) continue
      const n = Math.max(0, (Dm[g] ?? 0) - zoneStock(ctx, zs, z, g)); if (n <= 1e-9) continue; need[z][g] = n
      const runs = n / d.recipe.outQty; for (const inp of d.recipe.inputs) { const a = [...inp.any].sort((x, y) => zoneStock(ctx, zs, z, y) - zoneStock(ctx, zs, z, x))[0]; Dm[a] = (Dm[a] ?? 0) + runs * inp.qty } }
    for (const [g, d] of Object.entries(goodsDef)) if (d.tier === 'semi') { const n = Math.max(0, (Dm[g] ?? 0) - zoneStock(ctx, zs, z, g)); if (n > 1e-9) need[z][g] = n } }
  ctx.scratch.need = need; ctx.scratch.demand = demand
  ctx.scratch.signal = (p, g) => { const z = D.zoneOf(ctx, p); return D.scarcity(ctx, zoneStock(ctx, zs, z, g), demand[z]?.[g] ?? 0) }
  for (const [g, def] of Object.entries(ctx.ruleset.goods)) {
    if (def.tier !== 'raw') continue
    for (const p of Object.keys(ctx.state.world.provinces)) {
      const out = D.extract(ctx, p, g); if (out <= 0) continue
      const region = ctx.state.world.regionSnapshot.assignment[p], pool = def.extractPool
      const ks = Object.keys(cells(ctx)).filter(k => parseCellKey(k).region === region)
      const w = ks.map(k => D.poolLabour(ctx, k, pool) * W(ctx).cellProvShare(k, p)), tw = sum(w)
      ks.forEach((k, i) => credit(k, g, out * w[i] / (tw || 1)))
      ctx.scratch.lastOutput[p] = (ctx.scratch.lastOutput[p] ?? 0) + out
    }
  }
  // processing (zone-level), tier by tier so chains complete within the turn; labour follows value added
  for (const [k, gs] of Object.entries(prod)) { const c = cells(ctx)[k], z = D.cellZone(ctx, k), h = c.hoardFrac ?? 0             // raw output enters the market first; a hoarding cell withholds a fraction
    c.hoard ??= {}
    for (const [good, q] of Object.entries(gs)) { const held = q * h; if (held > 0) { c.hoard[good] = (c.hoard[good] ?? 0) + held; gs[good] = q - held }; zoneAdd(ctx, zs, z, good, gs[good]) }
    if (h === 0) for (const [good, q] of Object.entries(c.hoard)) if (q > 0) { zoneAdd(ctx, zs, z, good, q); gs[good] = (gs[good] ?? 0) + q; c.hoard[good] = 0 } }   // released when the cell stops hoarding
  const labLeft = {}                                                 // labour ledger per zone/pool: tiers draw down one budget (no double counting)
  for (const tier of ['semi', 'light', 'heavy', 'transport']) for (const [z, ps] of Object.entries(zs)) {
    for (const pool of new Set(Object.values(goodsDef).filter(x => x.tier === tier && x.recipe).map(x => x.recipe.pool))) {
      const key = `${z}|${pool}`; labLeft[key] ??= sum(ps.map(p => D.labourAt(ctx, p, pool)))
      const recs = Object.entries(goodsDef).filter(([g, d]) => d.tier === tier && d.recipe?.pool === pool && (need[z][g] ?? 0) > 1e-9)
      if (!recs.length || labLeft[key] <= 1e-9) continue
      const pick = (inp) => inp.any.map(a => [a, zoneStock(ctx, zs, z, a)]).sort((a, b) => b[1] - a[1])[0]
      const feasible = recs.filter(([, d]) => d.recipe.inputs.every(inp => pick(inp)[1] > 1e-9))
      const value = (g) => goodsDef[g].baseValue * D.scarcity(ctx, zoneStock(ctx, zs, z, g), need[z][g] ?? 0 + 0)   // live value: authored base x scarcity
      const margin = ([g, d]) => Math.max(1e-6, value(g) * d.recipe.outQty - sum(d.recipe.inputs.map(i => Math.min(...i.any.map(a => goodsDef[a].baseValue)) * i.qty)))
      const ws = feasible.map(r => margin(r) ** ctx.T('prod.theta'))
      const caps = feasible.map(([g, d]) => { let m = need[z][g] / d.recipe.outQty; for (const inp of d.recipe.inputs) m = Math.min(m, pick(inp)[1] / inp.qty); return Math.max(0, m) })
      const alloc = feasible.map(() => 0); let budget = labLeft[key]                       // water-filling: weights by value added, capped by need/inputs, leftovers redistributed
      for (let it = 0; it < 8 && budget > 1e-9; it++) {
        const open = feasible.map((r, i) => i).filter(i => alloc[i] < caps[i] - 1e-9), W = sum(open.map(i => ws[i])); if (!open.length || W <= 0) break
        let used = 0; for (const i of open) { const lab = Math.min(budget * ws[i] / W, (caps[i] - alloc[i]) * feasible[i][1].recipe.labourPerRun); alloc[i] += lab / feasible[i][1].recipe.labourPerRun; used += lab }
        budget -= used; if (used <= 1e-9) break }
      feasible.forEach(([g, d], i) => {
        const runs = alloc[i]
        if (runs <= 1e-9) return
        for (const inp of d.recipe.inputs) zoneTake(ctx, zs, z, pick(inp)[0], runs * inp.qty)
        labLeft[key] -= runs * d.recipe.labourPerRun
        const out = runs * d.recipe.outQty; zoneAdd(ctx, zs, z, g, out)
        const ks = Object.keys(cells(ctx)).filter(k => D.cellZone(ctx, k) === z), w = ks.map(k => D.poolLabour(ctx, k, pool)), t = sum(w) || 1
        ks.forEach((k, j) => credit(k, g, out * w[j] / t))
      })
    }
  }
  ctx.scratch.prod = prod
}
function landSplit(ctx) {                                              // holders take their share of a province's output first (Σ shares ≤ 1)
  const land = ctx.state.economy.land ?? {}
  for (const [p, holders] of Object.entries(land)) {
    const region = ctx.state.world.regionSnapshot.assignment[p]
    for (const h of holders) for (const [k, goods] of Object.entries(ctx.scratch.prod)) {
      if (parseCellKey(k).region !== region || !cells(ctx)[h.holder] || k === h.holder) continue
      for (const g of Object.keys(goods)) { const take = goods[g] * h.share * W(ctx).cellProvShare(k, p); goods[g] -= take; ctx.scratch.prod[h.holder] ??= {}; ctx.scratch.prod[h.holder][g] = (ctx.scratch.prod[h.holder][g] ?? 0) + take }
    }
  }
}
function requisition(ctx) {                                            // PRE-cascade
  for (const country of Object.keys(ctx.state.admin.governments)) {
    const law = ctx.state.polity.law[country]?.requisitions ?? [], sc = scopeCtx(ctx, country)
    for (const e of law) for (const k of sc.cellKeys()) {
      if (!covers(e.scope, k, sc)) continue
      const have = ctx.scratch.prod[k]?.[e.target.good] ?? 0, claimed = e.unit === 'fraction' ? e.amount * have : e.amount
      const inv = ctx.derive.polity.compliance(k).involuntary, delivered = Math.min(have, claimed * inv)
      if (ctx.scratch.prod[k]) ctx.scratch.prod[k][e.target.good] = have - delivered
      const g = gov(ctx, country); g.inventory ??= {}; g.inventory[e.target.good] = (g.inventory[e.target.good] ?? 0) + delivered
      ctx.polityQueue.requisitionHits.push({ cell: k, target: e.target.good, shortfall: claimed - delivered })
    } } }

// ---- prices (single pass, nothing stored) and cascade
function pricePass(ctx) {
  const zs = ctx.scratch.zs, goods = Object.keys(ctx.ruleset.goods), S = {}, Dm = {}
  for (const z of Object.keys(zs)) { S[z] = {}; Dm[z] = {}; for (const g of goods) { S[z][g] = zoneStock(ctx, zs, z, g); Dm[z][g] = 0 } }
  ctx.scratch.sales = {}                                               // cell -> goods put on the market (for sales value)
  for (const k of Object.keys(cells(ctx))) { const c = cells(ctx)[k], z = D.cellZone(ctx, k)
    for (const tier of ['subsistence', 'comfort', 'luxury']) for (const item of ctx.ruleset.consumption[tier] ?? []) Dm[z][[...item.any].sort((a, b) => zoneStock(ctx, zs, z, b) - zoneStock(ctx, zs, z, a))[0]] += item.perCapita * c.population }
  for (const [z, m] of Object.entries(ctx.scratch.mil ?? {})) for (const [g, q] of Object.entries(m)) if (Dm[z]) Dm[z][g] = (Dm[z][g] ?? 0) + q
  const lvl = ctx.derive.economics.priceLevel()
  const base = g => ctx.ruleset.goods[g].baseValue
  const pre = (z, g) => base(g) * D.scarcity(ctx, S[z][g], Dm[z][g]) * lvl
  for (const [a, b] of D.zoneEdges(ctx)) for (const g of goods) {       // cross-zone flows: one pass, capped by throughput
    let cap = D.throughputCap(ctx, a, b) * (ctx.derive.diplomacy?.tradeFactor(a, b, g) ?? 1); const [lo, hi] = pre(a, g) <= pre(b, g) ? [a, b] : [b, a]
    if (pre(hi, g) > pre(lo, g) * (1 + ctx.T('flow.friction'))) { const surplus = Math.max(0, S[lo][g] - Dm[lo][g]), q = Math.min(cap, surplus * ctx.T('flow.share'), zoneStock(ctx, zs, lo, g))
      if (q > 0) { zoneTake(ctx, zs, lo, g, q); zoneAdd(ctx, zs, hi, g, q); S[lo][g] -= q; S[hi][g] += q } } }
  ctx.scratch.price = (g, z) => base(g) * D.scarcity(ctx, S[z][g], Dm[z][g]) * lvl      // final scarcity from post-flow balances
  ctx.state.economy.lastMarket = Object.fromEntries(Object.keys(zs).map(z => [z, Object.fromEntries(goods.map(g => [g, { stock: S[z][g], demand: Dm[z][g], price: ctx.scratch.price(g, z) }]))]))   // @cache: the Economy workspace's Goods & Prices (rederivable)
}
function cascade(ctx) {
  const price = ctx.scratch.price, zs = ctx.scratch.zs, keys = Object.keys(cells(ctx)).sort()
  for (const k of keys) { const c = cells(ctx)[k], z = D.cellZone(ctx, k), prod = ctx.scratch.prod[k] ?? {}
    c.salesValue = sum(Object.entries(prod).map(([g, q]) => q * price(g, z)))
    c.salesValueBase = sum(Object.entries(prod).map(([g, q]) => q * ctx.ruleset.goods[g].baseValue))
    c.cash0 = c.salesValue + c.wealth * ctx.T('cash.wealthFraction'); c.cash = c.cash0; c.purchases = 0
    c.satisfaction = { subsistence: 1, comfort: 1, luxury: 1 } }
  for (const tier of ['subsistence', 'comfort', 'luxury']) {
    const items = ctx.ruleset.consumption[tier] ?? []
    items.forEach((item, idx) => { const wants = []
      for (const k of keys) { const c = cells(ctx)[k], z = D.cellZone(ctx, k); if (!ctx.derive.polity.marketAccess(k)) { wants.push({ k, z, g: item.any[0], q: 0, need: item.perCapita * c.population }); continue }
        const avail = a => zoneStock(ctx, zs, z, a) > 1e-9 ? 0 : 1, g = [...item.any].sort((a, b) => avail(a) - avail(b) || price(a, z) - price(b, z))[0], need = item.perCapita * c.population   // cheapest ALTERNATIVE THAT IS ON THE MARKET
        wants.push({ k, z, g, need, q: Math.min(need, c.cash / Math.max(1e-9, price(g, z))) }) }
      for (const z of Object.keys(zs)) for (const g of new Set(wants.filter(w => w.z === z).map(w => w.g))) {
        const ws = wants.filter(w => w.z === z && w.g === g), tot = sum(ws.map(w => w.q)), milq = tier === 'subsistence' ? (ctx.scratch.mil?.[z]?.[g] ?? 0) : 0, fill = tot > 0 ? Math.min(1, zoneStock(ctx, zs, z, g) / (tot + milq)) : 0   // army upkeep is a participant: its share stays in stock for step 4
        for (const w of ws) { const q = w.q * fill; zoneTake(ctx, zs, z, g, q); const c = cells(ctx)[w.k], cost = q * price(g, z); c.cash -= cost; c.purchases += cost; w.bought = q } }
      if (typeof process !== 'undefined' && process.env?.DBG) console.log('item', item.any.join('|'), 'need', Math.round(sum(wants.map(w => w.need))), 'bought', Math.round(sum(wants.map(w => w.bought ?? 0))), 'q', Math.round(sum(wants.map(w => w.q))))
      for (const w of wants) { const c = cells(ctx)[w.k]; c.satisfaction[tier] = Math.min(c.satisfaction[tier], 1)
        c.satisfaction[`_${tier}`] = (c.satisfaction[`_${tier}`] ?? 0) + Math.min(1, w.need ? (w.bought ?? 0) / w.need : 1) / items.length }
    })
  }
  for (const k of keys) { const c = cells(ctx)[k]; for (const t of ['subsistence', 'comfort', 'luxury']) { c.satisfaction[t] = clamp01(c.satisfaction[`_${t}`] ?? 1); delete c.satisfaction[`_${t}`] }
    c.shortfall = Math.max(0, (1 - c.satisfaction.subsistence)) * sum((ctx.ruleset.consumption.subsistence ?? []).map(i => i.perCapita * c.population * ctx.ruleset.goods[i.any[0]].baseValue)) }
}
export const dutyValue = (ctx, key, duty, dflt) => ctx.derive.polity.duty(key, duty, dflt)
function taxation(ctx) {
  ctx.scratch.tax = {}
  for (const [k, c] of Object.entries(cells(ctx))) { const rate = dutyValue(ctx, k, 'Taxation', { market: 0, wealth: 0 }), country = countryOfCell(ctx, k)
    const due = rate.market * c.salesValue + rate.wealth * c.wealth, paid = Math.min(due * ctx.derive.polity.compliance(k).involuntary * (1 - (c.defiance?.tax ?? 0)), Math.max(0, c.cash))   // defiance (tax refusal) scales delivery down
    c.cash -= paid; c.wealth = c.wealth + c.salesValue - c.purchases - paid; if (c.wealth < 0) c.wealth = 0       // Wealth never negative
    ctx.scratch.tax[country] = (ctx.scratch.tax[country] ?? 0) + paid } }
function debtService(ctx) {
  const e = ctx.state.economy; const keep = []
  for (const o of e.obligations) { const debtor = cells(ctx)[o.debtor], creditor = cells(ctx)[o.creditor]; if (!debtor || !creditor) continue
    const z = D.cellZone(ctx, o.debtor), rate = e.lastRate?.[z] ?? ctx.T('credit.r0'), due = o.principal * rate, paid = Math.min(due, debtor.wealth)
    debtor.wealth -= paid; creditor.wealth += paid; o.arrears += due - paid
    if (o.arrears > ctx.T('debt.arrearsLimit') * o.principal) ctx.polityQueue.defaults ??= [], ctx.polityQueue.defaults.push({ creditor: o.creditor, debtor: o.debtor, principal: o.principal })
    else keep.push(o) }
  e.obligations = keep }
function creditClearing(ctx) {                                         // greedy matching; no anonymous debts
  const e = ctx.state.economy, byZone = {}
  for (const k of Object.keys(cells(ctx)).sort()) (byZone[D.cellZone(ctx, k)] ??= []).push(k)
  for (const [z, ks] of Object.entries(byZone)) {
    const L = ks.map(k => { const c = cells(ctx)[k], res = c.population * ctx.T('credit.reservePerCap'); return { k, s: ctx.derive.polity.canLend(k) && c.wealth > res ? (c.wealth - res) * ctx.T('credit.lendFraction') : 0 } }).filter(x => x.s > 0).sort((a, b) => b.s - a.s || (a.k < b.k ? -1 : 1))
    const B = ks.map(k => ({ k, d: cells(ctx)[k].shortfall ?? 0 })).filter(x => x.d > 0).sort((a, b) => b.d - a.d || (a.k < b.k ? -1 : 1))
    const S = sum(L.map(x => x.s)), Dm = sum(B.map(x => x.d)); if (!S || !Dm) { (e.lastRate ??= {})[z] = ctx.T('credit.r0'); continue }
    const r = Math.min(ctx.derive.polity.legalCeiling?.(z) ?? Infinity, ctx.T('credit.r0') * (Dm / S) ** ctx.T('credit.eta')); (e.lastRate ??= {})[z] = r
    for (const b of B) { let need = b.d; for (const l of L) { if (need <= 1e-9) break; const amt = Math.min(l.s, need); if (amt <= 1e-9) continue
      l.s -= amt; need -= amt; cells(ctx)[l.k].wealth -= amt; cells(ctx)[b.k].wealth += amt; e.obligations.push({ id: `o${e.obligations.length}.${ctx.state.meta.turn}`, creditor: l.k, debtor: b.k, principal: amt, arrears: 0 }) } } } }
function ledgerUpdate(ctx, L0) {
  for (const country of Object.keys(ctx.state.admin.governments)) { const g = gov(ctx, country), start = L0[country]
    const r = resolveAllocation(g.spendingDial ?? { entries: [] }, start, scopeCtx(ctx, country))
    const spent = sum(r.rows.map(x => x.grant)); const mand = r.rows.filter(x => x.mandatory), need = sum(mand.map(x => x.floor))
    g.upkeepFraction = need > 0 ? clamp01(1 - sum(mand.map(x => x.grant)) / need) : 0
    g.ledger = Math.max(0, start - spent + (ctx.scratch.tax[country] ?? 0) + (g.borrowedThisTurn ?? 0)); g.borrowedThisTurn = 0 } }

import { stepTeaching } from './teaching.js'
export function step3(ctx) {
  ctx.scratch = {}; ctx._grav = null
  const L0 = Object.fromEntries(Object.entries(ctx.state.admin.governments).map(([c, g]) => [c, g.ledger]))
  production(ctx); landSplit(ctx); requisition(ctx); pricePass(ctx); cascade(ctx); taxation(ctx); debtService(ctx); creditClearing(ctx); stepTeaching(ctx); ledgerUpdate(ctx, L0)
  ctx.state.economy.lastOutput = ctx.scratch.lastOutput; ctx._grav = null
  for (const p of Object.keys(ctx.state.economy.tradeInfra)) ctx.state.economy.tradeInfra[p] = Math.max(0, ctx.state.economy.tradeInfra[p] - ctx.T('infra.decay'))   // trade infrastructure decays without upkeep
  ctx.state.economy.coinage.lastVolume = Math.max(1e-9, sum(Object.values(cells(ctx)).map(c => c.salesValueBase ?? 0)))
}

/** service for other modules (War supply): draw goods from the trade zone that contains `province`; returns the quantity actually taken */
export function drawFromZone(ctx, province, good, qty) { const zs = D.zones(ctx); return zoneTake(ctx, zs, D.zoneOf(ctx, province), good, qty) }
