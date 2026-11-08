import { step4, atWar, armyStrength, cellsIn, logScore } from './step.js'
import { stance, approves } from '../../kernel/stance.js'
import { isBloc, martialCost, resolveInternalPeace, activeBlocs } from './internal.js'
const sum = a => a.reduce((s, x) => s + x, 0)
const W = ctx => ctx.state.war
const cellsOfCountry = (ctx, c) => Object.values(ctx.state.polity.cells).filter(x => ctx.derive.worldmap.regionOwner(x.region) === c)
export const occupiedShare = (ctx, key) => { const [nation, , region] = key.split('|'), ps = ctx.derive.worldmap.regionProvinces(region)
  const tot = sum(ps.map(p => ctx.derive.worldmap.presence(p, nation))); return tot ? sum(ps.filter(p => { const o = W(ctx).occupations[p]; return o && !(isBloc(ctx, o.occupier) && ctx.state.polity.cells[key]?.flags?.rebel === o.occupier) }).map(p => ctx.derive.worldmap.presence(p, nation))) / tot : 0 }
export const exhaustion = (ctx, key) => ctx.state.polity.cells[key].warHarm ?? 0                    // read-only: war-attributable grievance, never an input
export function countryExhaustion(ctx, country) { const cs = cellsOfCountry(ctx, country), pop = sum(cs.map(c => c.population)) || 1; return sum(cs.map(c => (c.warHarm ?? 0) * c.population)) / pop }
export function warScore(ctx, side) {                                                                // running signed total of per-cell harm; context only
  let s = 0; for (const e of W(ctx).score) { const k = e.harm?.killed ?? e.harm?.turns ?? 0, target = ctx.derive.worldmap.regionOwner(ctx.state.polity.cells[e.cells[0]]?.region); if (!target) continue
    if (e.side === side && target !== side) s += k; else if (e.side !== side && target === side) s -= k } return s }
export function peaceEvaluation(ctx, side, enemy, terms) {                                           // willingness to ACCEPT peace: weak/exhausted -> yes, strong + terms costly -> no; WarScore is only the modifier
  const own = sum(Object.values(W(ctx).armies).filter(a => a.owner === side).map(a => armyStrength(ctx, a))), foe = sum(Object.values(W(ctx).armies).filter(a => a.owner === enemy).map(a => armyStrength(ctx, a)))
  const myProvs = Object.values(ctx.state.world.provinces).filter(p => p.owner === side).length || 1, cede = (terms.cede ?? []).filter(c => c.from === side).length / myProvs, gain = (terms.cede ?? []).filter(c => c.to === side).length / myProvs
  return stance(side, terms, ctx, { selfInterest: () => (0.5 - own / (own + foe + 1e-9)) + ctx.T('war.peace.exh') * countryExhaustion(ctx, side) - ctx.T('war.peace.cede') * cede + ctx.T('war.peace.cede') * gain - ctx.T('war.peace.treaty') * (terms.treaties ?? []).filter(t => (t.kind === 'Dependency' ? t.subject : t.target) === side).length,
    modifier: () => 1 + ctx.T('war.peace.scoreWeight') * Math.tanh(warScore(ctx, side) / 50) }) }
const handlers = {
  'war.declared': () => {},
  'war.hostilitiesBegin': (ctx, { war }) => { const w = W(ctx).wars.find(x => x.id === war); if (w && !w.ended) w.active = true },
  'war.peaceResolve': (ctx, { war, proposer, terms }) => { const w = W(ctx).wars.find(x => x.id === war); if (!w || !w.active) return
    if (w.internal) return resolveInternalPeace(ctx, w, terms)                                                       // rebel Peace Conference: Rights/Duties terms, secession = Formation
    const other = w.a === proposer ? w.b : w.a, ok = approves(peaceEvaluation(ctx, other, proposer, terms), ctx)      // the proposer accepts its own terms; the receiver judges them
    w.lastProposal = { turn: ctx.state.meta.turn, accepted: ok }; if (!ok) return
    for (const t of terms.treaties ?? []) ctx.services.diplomacy?.installTreaty(t)                                 // treaty terms of the Peace Conference (e.g. Dependency, Sanction)
    for (const c of terms.cede ?? []) ctx.state.world.provinces[c.province].owner = c.to                        // Countries-level change; Regions re-derive at step 8
    for (const p of Object.keys(W(ctx).occupations)) { const o = W(ctx).occupations[p]; if ([w.a, w.b].includes(o.occupier)) delete W(ctx).occupations[p] }   // occupation removal on ratified peace
    w.active = false; w.ended = ctx.state.meta.turn } }
/** military upkeep demand per supply-source province: [{province, good, qty}] — Economics adds it to zone demand and reserves it in the cascade */
export function upkeepBySource(ctx) { const out = []
  for (const a of Object.values(W(ctx).armies)) for (const id of a.units) { const u = W(ctx).units[id]; for (const [g, q] of Object.entries(ctx.ruleset.pools[u.pool].combat.upkeep)) out.push({ province: a.src ?? a.position, good: g, qty: q * u.n }) }
  return out }
export const warModule = { id: 'war', steps: { 4: step4 }, handlers, derive: { martialCost, blocs: ctx => activeBlocs(ctx), upkeepBySource, occupiedShare, exhaustion, countryExhaustion, warScore, atWar: (ctx, a, b) => atWar(ctx, a, b) } }
