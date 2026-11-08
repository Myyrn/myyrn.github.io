// war/actions.js — fieldUnits, orderMove, setTactic, declareWar, proposePeace (+ handlers in module.js)
import { findPath } from './graph.js'
import { atWar, armyStrength, logScore } from './step.js'
import { regionStock, takeRegionStock } from './stock.js'
import { registerInternalActions } from './internal.js'
const sum = a => a.reduce((s, x) => s + x, 0)
const cell = (ctx, k) => ctx.state.polity.cells[k], ownerOfCell = (ctx, k) => ctx.derive.worldmap.regionOwner(cell(ctx, k).region)
const myArmy = (ctx, a) => { const ar = ctx.state.war.armies[a.params.armyId]; return ar && ar.owner === a.actor.country ? ar : null }

export function registerWarActions(reg) {
  registerInternalActions(reg)
  reg.register({ id: 'fieldUnits', module: 'war', class: 'commitment', gateDomain: () => 'retinue', defaultVisibility: 'public', costs: () => [],
    validate: (ctx, a) => { const c = cell(ctx, a.params.originCell), comp = a.params.composition ?? {}; if (!c || ownerOfCell(ctx, c.key) !== a.actor.country) return { ok: false, reasons: ['origin cell must belong to the Country'] }
      for (const [pool, n] of Object.entries(comp)) { if (ctx.ruleset.pools[pool]?.kind !== 'army') return { ok: false, reasons: [`${pool} is not an army pool`] }
        if ((c.labour[pool] ?? 0) - (c.labourCommitted[pool] ?? 0) < n) return { ok: false, reasons: [`not enough ${pool} labour`] } }
      if (a.params.at && !ctx.derive.worldmap.regionProvinces(c.region).includes(a.params.at)) return { ok: false, reasons: ['muster point must lie in the origin Region'] }
      const men = sum(Object.values(comp)); if (!(men > 0)) return { ok: false, reasons: ['empty composition'] }
      const cap = ctx.derive.diplomacy?.militaryCap(a.actor.country) ?? Infinity            // MilitaryCap axis: ceiling on the Country's fielded men
      if (cap < Infinity && men + sum(Object.values(ctx.state.war.armies).filter(x => x.owner === a.actor.country).map(x => sum(x.units.map(id => ctx.state.war.units[id].n)))) > cap) return { ok: false, reasons: ['MilitaryCap axis: ceiling reached'] }
      if (regionStock(ctx, c.region, 'Cold Weapons') < men * ctx.T('war.field.goodsPerMan')) return { ok: false, reasons: ['not enough Cold Weapons in the recruiting Region'] }
      return { ok: true } },
    impact: () => ({ cost: 0.05, relief: 0 }),
    apply: (ctx, a) => { const c = cell(ctx, a.params.originCell), men = sum(Object.values(a.params.composition)); takeRegionStock(ctx, c.region, 'Cold Weapons', men * ctx.T('war.field.goodsPerMan'))
      const start = a.params.at ?? ctx.derive.worldmap.regionProvinces(c.region).sort((x, y) => ctx.derive.worldmap.presence(y, c.nation) - ctx.derive.worldmap.presence(x, c.nation))[0], id = ctx.nextId('a'), units = []
      for (const [pool, n] of Object.entries(a.params.composition)) { const uid = ctx.nextId('u'); c.labourCommitted[pool] = (c.labourCommitted[pool] ?? 0) + n
        ctx.state.war.units[uid] = { id: uid, army: id, originCell: c.key, pool, n, cohesion: 0.7, supply: 1, wounded: [] }; units.push(uid) }
      ctx.state.war.armies[id] = { id, owner: a.actor.country, units, position: start, prev: start, destination: null, path: [], tactic: 'balanced', stance: 'hold', traits: [] } } })
  reg.register({ id: 'orderMove', module: 'war', class: 'dial', gateDomain: () => null, defaultVisibility: 'public', costs: () => [],
    validate: (ctx, a) => { const ar = myArmy(ctx, a); if (!ar) return { ok: false, reasons: ['not your army'] }; const path = findPath(ctx, ar.position, a.params.to, ar); return path ? { ok: true } : { ok: false, reasons: ['no passable route'] } },
    apply: (ctx, a) => { const ar = myArmy(ctx, a); ar.destination = a.params.to; ar.path = findPath(ctx, ar.position, a.params.to, ar) ?? [] } })
  reg.register({ id: 'setTactic', module: 'war', class: 'dial', gateDomain: () => null, defaultVisibility: 'public', costs: () => [],
    validate: (ctx, a) => (myArmy(ctx, a) && ['balanced', 'aggressive', 'defensive'].includes(a.params.tactic) ? { ok: true } : { ok: false, reasons: ['bad army or tactic'] }),
    apply: (ctx, a) => { myArmy(ctx, a).tactic = a.params.tactic } })
  reg.register({ id: 'declareWar', module: 'war', class: 'event', gateDomain: () => 'war', defaultVisibility: 'public', costs: () => [], axisLoads: { ruthlessness_restraint: -1 },
    validate: (ctx, a) => (a.params?.target && a.params.target !== a.actor.country && ctx.state.countries[a.params.target] && !ctx.state.war.wars.some(w => !w.ended && [w.a, w.b].includes(a.actor.country) && [w.a, w.b].includes(a.params.target)) ? (ctx.derive.diplomacy?.warForbidden(a.actor.country, a.params.target) ? { ok: false, reasons: ['a treaty forbids this war (denounce it first)'] } : { ok: true }) : { ok: false, reasons: ['invalid target or already at war'] }),
    impact: (ctx, a, key) => ({ cost: 0.3 * Math.min(1, (cell(ctx, key).warHarm ?? 0) + 0.3), relief: 0 }),     // war is costly; exhaustion makes it costlier (same stance function as continuing)
    apply: (ctx, a) => { const id = ctx.nextId('w'); ctx.state.war.wars.push({ id, a: a.actor.country, b: a.params.target, active: false, startedTurn: ctx.state.meta.turn, goals: a.params.goals ?? [] })
      ctx.schedule({ dueTurnOffset: 0, dueStep: 7, kind: 'war.declared', payload: { war: id } }); ctx.schedule({ dueTurnOffset: 0, dueStep: 7, kind: 'diplomacy.warDeclared', payload: { war: id } }); ctx.schedule({ dueTurnOffset: 1, dueStep: 4, kind: 'war.hostilitiesBegin', payload: { war: id } }) } })
  reg.register({ id: 'proposePeace', module: 'war', class: 'event', gateDomain: () => 'war', defaultVisibility: 'public', costs: () => [], impact: () => ({ cost: 0, relief: 0.2 }),
    validate: (ctx, a) => (ctx.state.war.wars.some(w => w.id === a.params?.war && w.active && !w.ended && [w.a, w.b].includes(a.actor.country)) ? { ok: true } : { ok: false, reasons: ['no such active war'] }),
    apply: (ctx, a) => ctx.schedule({ dueTurnOffset: 0, dueStep: 7, kind: 'war.peaceResolve', payload: { war: a.params.war, proposer: a.actor.country, terms: a.params.terms ?? { cede: [] } } }) })
}
