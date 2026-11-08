// diplomacy/readouts.js — derived, never stored: Reputational Leverage, Leverage Categories, power ranking, great-power backing, CBs, closeness.
import { tick, value as stackValue } from '../../kernel/modifiers.js'
import { D, TIERS, rank, NON_AGGRESSION, treatiesOf, pairKey, partiesOf, countryIds, sum, clamp01 } from './common.js'
import { effectivePref } from '../polity/cellstate.js'
import { zoneEdges, throughputCap } from '../economics/derive.js'
const W = ctx => ctx.state.war
const ownerOf = (ctx, p) => ctx.state.world.provinces[p]?.owner

// ---- Reputational Leverage: per-(observer, subject) decaying stack = EXTERNAL belief about conduct. Never spendable; never the Portrait's Ruthlessness axis (kb Rule 5).
export function addReputation(ctx, observer, subject, delta, reason) {
  if (observer === subject || !delta) return
  const st = (D(ctx).leverage[pairKey(observer, subject)] ??= { baseline: 0, mods: [] })
  st.mods.push({ id: `rep.${reason}.${ctx.state.meta.turn}`, value: delta, decay: { kind: 'exp', rateKey: 'leverage.decay' }, turn: ctx.state.meta.turn, reason }) }
/** Standing bonus of an active Alliance >= Benevolent Neutrality is a readout over the treaty graph, not a stored modifier. */
export const allianceBonus = (ctx, a, b) => (treatyTier(ctx, a, b) ? ctx.T('rep.allianceBonus') : 0)
export const reputation = (ctx, observer, subject) => (D(ctx).leverage[pairKey(observer, subject)] ? stackValue(D(ctx).leverage[pairKey(observer, subject)]) : 0) + allianceBonus(ctx, observer, subject)
export function decayStacks(ctx) {
  for (const k of Object.keys(D(ctx).leverage)) { const st = D(ctx).leverage[k]; tick(st, ctx); if (!st.mods.length) delete D(ctx).leverage[k] }
  for (const cb of D(ctx).cbs) tick({ baseline: 0, mods: cb.mods }, ctx)
  D(ctx).cbs = D(ctx).cbs.filter(cb => cb.mods.reduce((s, m) => s + m.value, 0) > ctx.T('eps.cb')) }

// ---- treaty graph
/** The strongest alliance-like tier binding two parties (a Guarantee binds in the guarantor->guaranteed direction only, listed as tier 'Guarantee'). */
export function treatyTier(ctx, a, b) {
  let best = null
  for (const t of treatiesOf(ctx)) {
    if (t.kind === 'Confederation' && t.parties.includes(a) && t.parties.includes(b)) best = 'Confederation'
    else if (t.kind === 'Alliance' && t.parties.includes(a) && t.parties.includes(b) && ['BenevolentNeutrality', 'Defensive', 'StandingOffensive', 'Coalition', 'Guarantee'].includes(t.tier) && !best) best = t.tier }
  return best }
export const warForbidden = (ctx, a, b) => treatiesOf(ctx).some(t => (t.kind === 'Confederation' || (t.kind === 'Alliance' && NON_AGGRESSION.includes(t.tier))) && t.parties.includes(a) && t.parties.includes(b))
/** Every axis grant in force: grantor (the party that gives something up) -> grantee. Dependency: subject->overlord; Sanction: target->imposers; Confederation/Alliance axes are symmetric. */
export function axisGrants(ctx) {
  const out = []
  for (const t of treatiesOf(ctx)) { const push = (grantor, grantee, g) => out.push({ grantor, grantee, axis: g.axis, terms: g.terms ?? {}, scope: g.scope, treaty: t.id })
    for (const g of t.axes ?? []) {
      if (t.kind === 'Dependency') push(t.subject, t.overlord, g)
      else if (t.kind === 'Sanction') for (const i of t.imposers) push(t.target, i, g)
      else for (const x of t.parties ?? []) for (const y of t.parties) if (x !== y) push(x, y, g) } }
  return out }
export const grantsOver = (ctx, grantor, axis) => axisGrants(ctx).filter(g => g.grantor === grantor && g.axis === axis)

// ---- power / great-power backing ("Concert" is a metaphor: no body; a Sanction/Coalition is backed when its imposers hold enough of the strongest Countries' weight)
export const armyMen = (ctx, owner) => sum(Object.values(W(ctx).armies).filter(a => a.owner === owner).map(a => sum(a.units.map(id => W(ctx).units[id]?.n ?? 0))))
export function power(ctx, country) {
  const ids = countryIds(ctx), men = sum(ids.map(c => armyMen(ctx, c))) || 1, pop = sum(Object.values(ctx.state.polity.cells).map(c => c.population)) || 1
  const mine = sum(Object.values(ctx.state.polity.cells).filter(c => ctx.derive.worldmap.regionOwner(c.region) === country).map(c => c.population))
  return ctx.T('gp.milWeight') * armyMen(ctx, country) / men + (1 - ctx.T('gp.milWeight')) * mine / pop }
export const greatPowerBacked = (ctx, imposers) => { const all = sum(countryIds(ctx).map(c => power(ctx, c))) || 1; return sum(imposers.map(c => power(ctx, c))) / all >= ctx.T('gp.share') }

// ---- Leverage Categories: derived per-(Country, Country|bloc) readouts. NEVER summed in simulation code; weighting happens only at an AI decision.
export function tradeDependency(ctx, a, b) {                                      // throughput-based: the capacity of the trade edges that cross between the two Countries
  let t = 0; for (const [x, y] of zoneEdges(ctx)) { const ox = ownerOf(ctx, x), oy = ownerOf(ctx, y); if ((ox === a && oy === b) || (ox === b && oy === a)) t += throughputCap(ctx, x, y) } return t }
export function leverage(ctx, a, bOrBloc) {                                       // bOrBloc: a Country id or an array of Country ids (an alliance bloc)
  const bs = Array.isArray(bOrBloc) ? bOrBloc : [bOrBloc], keys = Object.keys(ctx.state.polity.cells).filter(k => bs.includes(ctx.derive.worldmap.regionOwner(ctx.state.polity.cells[k].region)))
  const ideal = ctx.derive.polity.amalgam?.(a) ?? {}, tw = sum(keys.map(k => ctx.derive.polity.weight(k))) || 1
  return { economic: sum(bs.map(b => tradeDependency(ctx, a, b))), diplomatic: sum(bs.map(b => reputation(ctx, b, a))),
    military: armyMen(ctx, a) - sum(bs.map(b => armyMen(ctx, b))) - ctx.T('leverage.exhaustion') * (ctx.derive.war?.countryExhaustion?.(a) ?? 0),
    cultural: sum(keys.map(k => ctx.derive.polity.weight(k) * (1 - sum(Object.entries(ideal).map(([ax, v]) => Math.abs(effectivePref(ctx.state.polity.cells[k], ax) - v) / 2)) / (Object.keys(ideal).length || 1)))) / tw } }

// ---- Casus Belli: state-based + structural are DERIVED on read; only event-based are stored
// Existential CBs are event-based (Great-War-chain trigger, coalition action backed by the great powers): granted through grantCB.
export function activeCBs(ctx, holder, target) {
  const out = [], P = ctx.state.world.provinces
  if (Object.entries(W(ctx).occupations).some(([p, o]) => o.occupier === target && P[p]?.owner === holder)) out.push({ tier: 'Sovereignty', reason: 'occupied-territory', class: 'state' })       // persists while the fact holds, no timer
  for (const t of treatiesOf(ctx)) if (t.breach && t.breach.by === target && partiesOf(t).includes(holder) && !t.breach.remedied) out.push({ tier: t.breach.tier ?? 'Rights', reason: 'unremedied-breach', class: 'state', treaty: t.id })
  for (const cb of D(ctx).cbs) if (cb.holder === holder && cb.target === target && cb.mods.reduce((s, m) => s + m.value, 0) > ctx.T('eps.cb')) out.push({ tier: cb.tier, reason: cb.reason, class: 'event', id: cb.id, recognised: externallyRecognised(ctx, cb) })
  if (D(ctx).claims.some(c => c.holder === holder && c.target === target && P[c.province]?.owner === target)) out.push({ tier: 'Rights', reason: 'claim', class: 'structural' })                    // long-lasting claims (RelationState.claims)
  const nations = ctx.state.countries[holder]?.titularNations ?? []
  if (nations.length && Object.entries(P).some(([p, pr]) => pr.owner === target && pr.population > 0 && sum(nations.map(n => ctx.derive.worldmap.presence(p, n))) / pr.population >= ctx.T('cb.nationalism.share'))) out.push({ tier: 'Rights', reason: 'nationalism', class: 'structural' })   // titular/kin Nation presence in foreign provinces
  if (W(ctx).wars.filter(w => w.a === holder && !w.internal && !w.chained).length >= ctx.T('cb.militaristic.wars')) out.push({ tier: 'Rights', reason: 'militaristic-disposition', class: 'structural' })    // war record in the decision history; the Portrait's Ruthlessness is not modelled yet
  return out }
export const bestCBRank = (ctx, holder, target) => Math.max(0, ...activeCBs(ctx, holder, target).map(c => rank(c.tier)))
/** CB external recognition (independent of tier): an active Sanction with `stripsCB` against the holder removes it. */
export const externallyRecognised = (ctx, cb) => !treatiesOf(ctx).some(t => t.kind === 'Sanction' && t.target === cb.holder && t.stripsCB)
export function grantCB(ctx, holder, target, tier, reason, magnitude = 1) {
  let cb = D(ctx).cbs.find(c => c.holder === holder && c.target === target && c.tier === tier && c.reason === reason)
  if (!cb) D(ctx).cbs.push(cb = { id: ctx.nextId('cb'), holder, target, tier, reason, mods: [] })
  cb.mods.push({ id: `cb.${ctx.state.meta.turn}`, value: magnitude, decay: { kind: 'exp', rateKey: `cb.decay.${tier}` }, turn: ctx.state.meta.turn }) }   // persistence scales with tier via the decay key

// ---- overreach: PER OBSERVER, never global
const GOAL_TIER = { tribute: 'Grievance', cede: 'Rights', dependency: 'Sovereignty', annex: 'Sovereignty' }
export const goalsRank = goals => Math.max(0, ...(goals ?? []).map(g => rank(GOAL_TIER[g.type] ?? 'Grievance')))
/** How close an observer is to the victim: alliance tier, kin ties, trade dependence (all via tuning). */
export function closeness(ctx, observer, victim) {
  if (observer === victim) return 1
  const tier = treatyTier(ctx, observer, victim), dep = treatiesOf(ctx).some(t => t.kind === 'Dependency' && [t.overlord, t.subject].includes(observer) && [t.overlord, t.subject].includes(victim)) ? ctx.T('closeness.Dependency') : 0
  const kin = (ctx.state.countries[observer]?.titularNations ?? []).some(n => (ctx.state.countries[victim]?.titularNations ?? []).includes(n)) ? ctx.T('closeness.kin') : 0
  return clamp01(Math.max(tier ? ctx.T(`closeness.${tier}`) : 0, dep, kin) + Math.min(1, tradeDependency(ctx, observer, victim) / ctx.T('overreach.tradeNorm'))) }
export function applyOverreach(ctx, war) {
  const gap = Math.max(0, goalsRank(war.goals) - bestCBRank(ctx, war.a, war.b)), mag = ctx.T('overreach.k') * gap, hits = {}
  if (!mag) return hits
  for (const o of countryIds(ctx)) { if (o === war.a) continue; const h = mag * closeness(ctx, o, war.b); if (h > 0) { addReputation(ctx, o, war.a, -h, 'overreach'); hits[o] = h } }
  return hits }
