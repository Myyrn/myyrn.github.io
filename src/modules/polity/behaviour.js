// polity/behaviour.js — acceptance, entitlement loss, gating hooks, cell action choice, factions.
import { stance, approves } from '../../kernel/stance.js'
import { scopeCtx } from '../administration/module.js'
import { covers } from '../../kernel/scope.js'
import { parseCellKey } from '../../kernel/ids.js'
import { effectivePref } from './cellstate.js'
const sum = a => a.reduce((s, x) => s + x, 0), clamp01 = x => Math.min(1, Math.max(0, x))
const cells = ctx => ctx.state.polity.cells
const countryOf = (ctx, k) => ctx.derive.worldmap.regionOwner(parseCellKey(k).region)

export function cellRung(ctx, key) { let r = 0; for (const [k, v] of Object.entries(ctx.state.polity.rung ?? {})) if (k.startsWith(key + '|')) r = Math.max(r, v); return r }
export function crisisSeverity(ctx, addresses, country) {            // read from live Question state, never stored as a global
  const w = id => (ctx.ruleset.needs[id]?.class === 'existential' ? 1 : 0.5)
  return Math.max(0, ...ctx.derive.polity.questions().filter(q => addresses.includes(q.need) && countryOf(ctx, q.cell) === country).map(q => clamp01(q.gap) * w(q.need))) }
export function acceptance(ctx, key, a, cost) {
  const country = countryOf(ctx, key), addr = a.params?.addresses ?? [], c = cells(ctx)[key]
  const costs = Object.keys(cells(ctx)).filter(k => countryOf(ctx, k) === country).map(k => ctx.registry.get(a.type).impact?.(ctx, a, k)?.cost ?? 0), mean = sum(costs) / (costs.length || 1)
  const burdenShare = clamp01(0.5 * cost / (mean + 1e-9)), g = ctx.state.admin.governments[country], alt = clamp01((g?.ledger ?? 0) / ((g?.ledger ?? 0) + ctx.T('acc.altScale')))
  return clamp01(ctx.T('acc.w0') + ctx.T('acc.crisis') * crisisSeverity(ctx, addr, country) + ctx.T('acc.exposure') * Math.max(0, ...addr.map(n => c.grievance?.[n] ?? 0))
                 + ctx.T('acc.burden') * (1 - burdenShare) - ctx.T('acc.alt') * alt) }
export function gateHolders(ctx, actor, domain) {                      // cells holding the covering Veto (privileges, not a parameter)
  const country = actor.country ?? countryOf(ctx, actor.key)
  return Object.keys(cells(ctx)).filter(k => countryOf(ctx, k) === country && ctx.derive.polity.right(k, `Veto.${domain}`) === true).sort() }
export function stanceFns(ctx, type) {
  const t = ctx.registry.get(type)
  return { selfInterest: (key, a) => { const { cost = 0, relief = 0 } = t.impact?.(ctx, a, key) ?? {}; return acceptance(ctx, key, a, cost) + relief - cost },
           modifier: (key, a) => alignment(ctx, key, t.axisLoads) } }
export const alignment = (ctx, key, loads) => Math.max(0, 1 + ctx.T('stance.align') * sum(Object.entries(loads ?? {}).map(([ax, sg]) => Math.sign(sg) * effectivePref(cells(ctx)[key], ax))))
export function entitlementLoss(ctx, holders, a) {                     // forced through Control: same acceptance function as any loss; no bespoke penalty
  const t = ctx.registry.get(a.type)
  for (const k of holders) { const { cost = 0 } = t.impact?.(ctx, a, k) ?? {}, acc = acceptance(ctx, k, a, cost), c = cells(ctx)[k]
    ;(c.fairnessMods ??= []).push({ id: `loss.${a.id}`, value: cost * (1 - acc) + ctx.T('eps.modifier'), decay: { kind: 'ctx', fn: 'lossDecay' }, turn: ctx.state.meta.turn, source: a.id, addresses: a.params?.addresses ?? [] }) } }
export const decayFns = { lossDecay: (ctx, mod) => {                   // read from CURRENT state, never from crisis age
  const live = (mod.addresses ?? []).length && ctx.derive.polity.questions().some(q => mod.addresses.includes(q.need))
  return live ? ctx.T('loss.decay.live') : (mod.addresses ?? []).length ? ctx.T('loss.decay.restored') : ctx.T('loss.decay.inForce') } }

/** Cells act. Available = permitted ∪ granted (held Right) ∪ defiance (capability). Chosen by the shared stance skeleton; rung gates availability. */
export function decideCellActions(ctx) {
  const out = []
  for (const key of Object.keys(cells(ctx)).sort()) {
    const c = cells(ctx)[key]; c.defiance = {}; c.hoardFrac = 0                                      // commitments are re-decided every turn
    const rung = cellRung(ctx, key), inv = ctx.derive.polity.compliance(key).involuntary
    let best = null
    for (const t of ctx.registry.cellTypes()) {
      if ((t.minRung ?? 0) > rung) continue
      if (t.cellAvailability === 'granted' && ctx.derive.polity.right(key, t.requiresRight) !== true) continue
      const params = t.propose?.(ctx, key); if (!params) continue
      const a = { id: `c${ctx.state.meta.turn}.${key}.${t.id}`, actor: { kind: 'cell', key }, type: t.id, params }
      const forbidden = ctx.derive.polity.right(key, `Forbid.${t.id}`) === true
      const s = stance(key, a, ctx, { selfInterest: () => t.utility(ctx, key, params) * (forbidden ? 1 - inv : 1), modifier: () => alignment(ctx, key, t.axisLoads) })
      if (forbidden) a.params = { ...params, scale: 1 - inv }
      if (s > ctx.T('cell.minUtility') && (!best || s > best.s)) best = { a, s } }
    if (best) out.push(best.a) }
  return out }

/** Factions: derived per issue (need) at read time, never persisted. Estate groups merge across Nations unless their Preference alignment is below the fracture bound;
 *  within a Nation, Estate groups with aligned vectors form blocs. */
export function factions(ctx) {
  const qs = ctx.derive.polity.questions(), byIssue = {}
  for (const q of qs) (byIssue[q.need] ??= []).push(q)
  const dist = (a, b) => { const ax = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]); return sum([...ax].map(x => Math.abs((a?.[x] ?? 0) - (b?.[x] ?? 0)))) / (ax.size || 1) }
  const out = []
  for (const [need, list] of Object.entries(byIssue)) {
    const mom = k => ctx.state.polity.momentum[`${k}|${need}`] ?? 0, w = k => ctx.derive.polity.weight(k)
    const groups = {}
    for (const q of list) { const { nation, estate } = parseCellKey(q.cell), country = countryOf(ctx, q.cell); (groups[`${country}|${estate}`] ??= []).push(q.cell) }
    const factions = []
    for (const [gk, members] of Object.entries(groups)) {                                      // 1: merge Estate cells across Nations, fracture by Nation when vectors are far apart
      const byNation = {}; for (const m of members) (byNation[parseCellKey(m).nation] ??= []).push(m)
      const nations = Object.keys(byNation), far = nations.length > 1 && dist(cells(ctx)[byNation[nations[0]][0]].pref, cells(ctx)[byNation[nations[1]][0]].pref) > -ctx.T('faction.fracture')
      if (far) for (const n of nations) factions.push({ estate: gk.split('|')[1], country: gk.split('|')[0], nations: [n], cells: byNation[n] })
      else factions.push({ estate: gk.split('|')[1], country: gk.split('|')[0], nations, cells: members }) }
    const blocs = []                                                                          // 2: cross-Estate blocs by alignment (per country)
    for (const f of factions) { const prefOf = ff => cells(ctx)[ff.cells[0]].pref
      const home = blocs.find(b => b.country === f.country && b.factions.every(o => 1 - dist(prefOf(o), prefOf(f)) >= ctx.T('faction.align') - 1))
      if (home) home.factions.push(f); else blocs.push({ country: f.country, factions: [f] }) }
    for (const b of blocs) { const ks = b.factions.flatMap(f => f.cells), tw = sum(ks.map(w)) || 1
      out.push({ need, country: b.country, estates: [...new Set(b.factions.map(f => f.estate))], cells: ks, weight: tw, momentum: sum(ks.map(k => w(k) * mom(k))) / tw, fullNation: b.factions.length > 1 }) } }
  return out }
