// Mobility, Demotion, Convergence, propaganda, Teaching — against the real engine (fixtures world + the demo scenario).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveTurn, makeCtx } from '../src/engine/engine.js'
import { createRegistry } from '../src/modules/index.js'
import { cellKey } from '../src/kernel/ids.js'
import { value as stackValue } from '../src/kernel/modifiers.js'
import { ruleset as baseRuleset, modules, makeState } from './fixtures.js'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
import { stepMobility } from '../src/modules/polity/mobility.js'
import { stepDemotion, netPosition } from '../src/modules/polity/demotion.js'
import { convergenceCandidates, divergeCell } from '../src/modules/polity/convergence.js'
import { pushPreference, stepPropaganda, directedShare } from '../src/modules/polity/propaganda.js'
import { effectivePref } from '../src/modules/polity/cellstate.js'
import { teachCell, stepTeaching } from '../src/modules/economics/teaching.js'

const registry = createRegistry()
const ruleset = { ...baseRuleset,
  pools: { ...baseRuleset.pools, Mining: { envelope: {} }, Teaching: { envelope: {} }, Culture: { envelope: {} }, Cavalry: { envelope: {} } },
  rights: { ...baseRuleset.rights, EstateMobility: { silentDefault: 0, prestigeWeight: 0 }, 'Veto.administration': { silentDefault: false, prestigeWeight: 0 } },
  duties: { ...baseRuleset.duties, Demotion: { prestigeWeight: 0 } } }
const gov = { kind: 'government', country: 'A' }
const mkCell = (nation, estate, pop, labour = {}, o = {}) => ({ key: cellKey(nation, estate, 'r1'), nation, estate, region: 'r1', population: pop, wealth: o.wealth ?? 50, labour: { ...labour },
  labourCommitted: {}, grievance: {}, satisfaction: { subsistence: 1, comfort: 1, luxury: 1 }, target: {}, delivered: {}, opinionGovMods: [], prestigeMods: o.prestige ? [{ id: 'p', value: o.prestige, decay: { kind: 'none' }, turn: 0 }] : [],
  fairnessMods: [], cash: 0, pref: { ...(o.pref ?? {}) }, prefMods: {}, defiance: {}, hoard: {}, hoardFrac: 0, laborProfile: { ...(o.profile ?? {}) }, flags: {} })
/** one Country, one Region, Nation v with three Estates (+ the fixture's k peasants) */
function world({ control = false } = {}) {
  const s = makeState(); s.polity.cells = {}
  for (const c of [mkCell('v', 'nobles', 100, { Agriculture: 50 }, { prestige: 3 }), mkCell('v', 'burghers', 200, { Agriculture: 100 }, { prestige: 1.5 }), mkCell('v', 'peasants', 1000, { Agriculture: 400 }),
                   mkCell('k', 'peasants', 1000, { Agriculture: 400 })]) s.polity.cells[c.key] = c
  if (control) { s.admin.governments.A.controlSupply = 1e9; s.admin.governments.A.controlDial = { entries: [{ target: { kind: 'empire' }, floor: 0, priority: 1, surplusWeight: 1 }] } }
  return s }
const ctxOf = s => { const c = makeCtx(s, ruleset, { modules, registry, start: s }); c.report = { executed: [] }; return c }
const run = (s, orders = [], n = 1) => { let st = s; for (let i = 0; i < n; i++) st = resolveTurn(st, ruleset, i === 0 ? orders : [], { modules, registry }).state; return st }
const reform = (id, kind, rid, scope, value) => ({ id, actor: gov, type: 'reformRightsDuties', params: { entries: [{ kind, id: rid, scope, value }] } })
const totalPop = s => Object.values(s.polity.cells).reduce((a, c) => a + c.population, 0)
const estate = e => ({ kind: 'estate', estate: e })
const K = e => cellKey('v', e, 'r1')

test('Mobility: needs the Right AND a Government gap; moves pro-rata stocks; population conserved; reactions target the Government', () => {
  const s = world(); s.polity.law.A.rights.EstateMobility = [{ scope: estate('peasants'), value: 1, declaredTurn: 0 }]
  let c = ctxOf(s); assert.equal(stepMobility(c).length, 0, 'no gap set -> not eligible')
  s.polity.mobilityGap = { A: { 'peasants>burghers': 5 } }; c = ctxOf(s)
  const pop0 = totalPop(s), peasWealth = s.polity.cells[K('peasants')].wealth
  const r = stepMobility(c); assert.equal(r.length, 1)
  const p = s.polity.cells[K('peasants')], b = s.polity.cells[K('burghers')]
  assert.ok(Math.abs(r[0].moved - 100) < 1e-9)                       // 1.0 x 0.1 x 1000
  assert.ok(Math.abs(p.wealth - peasWealth * 0.9) < 1e-9 && Math.abs(p.labour.Agriculture - 360) < 1e-9 && Math.abs(b.labour.Agriculture - 140) < 1e-9, 'movers carry pro-rata stocks and labour')
  assert.ok(Math.abs(totalPop(s) - pop0) < 1e-9)
  assert.ok(p.opinionGovMods.some(m => m.value > 0) && b.opinionGovMods.some(m => m.value < 0))
})
test('Mobility: a too-small prestige gap blocks; revoking the Right stops flow but never reverts movers', () => {
  const s = world(); s.polity.law.A.rights.EstateMobility = [{ scope: estate('peasants'), value: 1, declaredTurn: 0 }]
  s.polity.mobilityGap = { A: { 'peasants>nobles': 1 } }          // nobles are 3 above peasants
  assert.equal(stepMobility(ctxOf(s)).length, 0)
  s.polity.mobilityGap.A['peasants>nobles'] = 10; stepMobility(ctxOf(s)); const after = s.polity.cells[K('nobles')].population
  s.polity.law.A.rights.EstateMobility = [{ scope: estate('peasants'), value: 0, declaredTurn: 2 }]
  assert.equal(stepMobility(ctxOf(s)).length, 0); assert.equal(s.polity.cells[K('nobles')].population, after)
})
test('Demotion: only on negative net position and with compliance; closest prestige below; debt follows; Control gain; heavy opinion hit', () => {
  const s = world({ control: true }); s.polity.law.A.duties.Demotion = [{ scope: estate('nobles'), value: 1, declaredTurn: 0 }]
  const n = s.polity.cells[K('nobles')]; n.wealth = 0
  s.economy.obligations = [{ id: 'o1', creditor: K('burghers'), debtor: K('nobles'), principal: 50, arrears: 0 }]
  let c = ctxOf(s); assert.ok(netPosition(c, K('nobles')) < 0)
  const r = stepDemotion(c); assert.equal(r.length, 1); assert.equal(r[0].to, K('burghers'), 'closest prestige below (1.5), not peasants (0)')
  assert.ok(r[0].moved > 0 && r[0].moved < 100)
  const owed = s.economy.obligations.filter(o => o.debtor === K('nobles')).reduce((a, o) => a + o.principal, 0); assert.ok(owed < 50, 'part of the debt moved with the cohort')
  assert.ok(s.admin.governments.A.controlBonus > 0); assert.ok(n.opinionGovMods.some(m => m.value < 0))
  assert.ok(c.derive.administration.controlSupply('A') >= s.admin.governments.A.controlBonus)
  n.wealth = 1e6; assert.equal(stepDemotion(ctxOf(s)).length, 0, 'positive net position -> no demotion')
  const s2 = world(); s2.polity.law.A.duties.Demotion = [{ scope: estate('nobles'), value: 1, declaredTurn: 0 }]; s2.polity.cells[K('nobles')].wealth = 0
  s2.economy.obligations = [{ id: 'o', creditor: K('burghers'), debtor: K('nobles'), principal: 50, arrears: 0 }]
  assert.equal(stepDemotion(ctxOf(s2)).length, 0, 'no Control -> no delivery of the duty (delivered = claimed x involuntary compliance)')
})
test('Rights/Duties reform action: sets scoped entries, most specific wins, null removes; unknown ids rejected, not thrown', () => {
  let s = world(); const order = (id, p) => ({ id, actor: gov, type: 'reformRightsDuties', params: { entries: p } })
  s = run(s, [order('a1', [{ kind: 'rights', id: 'EstateMobility', scope: { kind: 'empire' }, value: 0.2 }, { kind: 'rights', id: 'EstateMobility', scope: estate('peasants'), value: 0.8 }])])
  const c = ctxOf(s); assert.equal(c.derive.polity.right(K('peasants'), 'EstateMobility'), 0.8); assert.equal(c.derive.polity.right(K('nobles'), 'EstateMobility'), 0.2)
  s = run(s, [order('a2', [{ kind: 'rights', id: 'EstateMobility', scope: estate('peasants'), value: null }])])
  assert.equal(ctxOf(s).derive.polity.right(K('peasants'), 'EstateMobility'), 0.2)
  const r = resolveTurn(s, ruleset, [order('a3', [{ kind: 'rights', id: 'Nope', scope: { kind: 'empire' }, value: 1 }])], { modules, registry }); assert.equal(r.report.rejected.length, 1)
})
test('pipeline: reform + gap orders drive Mobility end to end; population conserved; deterministic', () => {
  const orders = [reform('r1', 'rights', 'EstateMobility', estate('peasants'), 1), { id: 'g1', actor: gov, type: 'setMobilityGap', params: { from: 'peasants', to: 'burghers', gap: 5 } }]
  const a = run(world(), orders, 3), b = run(world(), orders, 3)
  assert.deepEqual(a, b); assert.ok(a.polity.cells[K('burghers')].population > 200); assert.ok(Math.abs(totalPop(a) - totalPop(world())) < 1e-6)
  for (const c of Object.values(a.polity.cells)) assert.ok(c.wealth >= 0 && c.population >= 0)
})
test('Convergence: trigger is checklist distance 0 (a Council seat blocks it); declared route merges at step 8 and conserves everything', () => {
  const s = world(); assert.ok(convergenceCandidates(ctxOf(s)).some(p => p.includes(K('nobles')) && p.includes(K('peasants'))), 'no laws differ: distance 0')
  s.polity.law.A.rights.Council = [{ scope: estate('nobles'), value: true, declaredTurn: 0 }]
  assert.ok(!convergenceCandidates(ctxOf(s)).some(p => p.includes(K('nobles'))), 'Council seat differs -> distance > 0')
  delete s.polity.law.A.rights.Council
  s.polity.cells[K('nobles')].laborProfile = { Cavalry: 1 }; s.polity.cells[K('peasants')].laborProfile = { Agriculture: 1 }
  s.polity.cells[K('nobles')].grievance = { subsistence: 0.6 }; s.polity.cells[K('peasants')].grievance = { subsistence: 0.2 }
  const pop0 = totalPop(s), peasPop = s.polity.cells[K('peasants')].population
  const r = resolveTurn(s, ruleset, [{ id: 'd1', actor: gov, type: 'declareConvergence', params: { scope: { nation: 'v' } } }], { modules, registry }), n = r.state
  const merged = n.polity.cells['v|nobles+peasants|r1'] ?? Object.values(n.polity.cells).find(c => c.flags?.converged)
  assert.ok(merged, `merged cell exists: ${Object.keys(n.polity.cells)}`); assert.ok(merged.estate.includes('+') && merged.flags.converged)
  const orig = { nobles: 100, burghers: 200, peasants: peasPop }
  assert.ok(Math.abs(merged.population - merged.flags.parts.reduce((a, p) => a + orig[p.estate], 0)) < 1e-6, 'merged population = sum of its parts (one pair per Nation x Region per act)')
  assert.ok(Math.abs(totalPop(n) - pop0) < 1e-6, 'population-sum constraint holds')
  const parts = merged.flags.parts.map(p => p.estate), prof = { nobles: { Cavalry: 1 }, peasants: { Agriculture: 1 }, burghers: {} }, tw = parts.reduce((a, e) => a + orig[e], 0)
  for (const pool of ['Cavalry', 'Agriculture']) assert.ok(Math.abs((merged.laborProfile[pool] ?? 0) - parts.reduce((a, e) => a + (prof[e][pool] ?? 0) * orig[e], 0) / tw) < 1e-9, `population-weighted blend of ${pool}`)
  const n2 = run(n, [], 2); assert.ok(Object.values(n2.polity.cells).some(c => c.flags?.converged), 'survives further turns (law scopes still cover the merged label)')
})
test('Convergence: estate-forced route (top rung, defiance) runs the same merge; a later reform reverses it by pro-rata split', () => {
  const s = world(); const p = s.polity.cells[K('peasants')], nb = s.polity.cells[K('nobles')]
  p.grievance = { subsistence: 0.95 }; s.polity.rung = { [`${K('peasants')}|subsistence`]: 4 }
  const acts = modules.find(m => m.id === 'polity').decideCellActions(ctxOf(s)).filter(a => a.actor.key === K('peasants')).map(a => a.type)
  assert.ok(acts.includes('forceConvergence'), `acts: ${acts}`)
  const merged = run(s, [], 1); assert.ok(Object.values(merged.polity.cells).some(c => c.flags?.converged), 'estate-forced merge executed')
  const mk = Object.keys(merged.polity.cells).find(k => merged.polity.cells[k].flags?.converged)
  merged.polity.law.A.rights.Council = [{ scope: estate(merged.polity.cells[mk].flags.parts[0].estate), value: true, declaredTurn: 9 }]
  const keys = divergeCell(ctxOf(merged), mk); assert.ok(keys && keys.length >= 2)
  assert.ok(!merged.polity.cells[mk]); assert.ok(Math.abs(totalPop(merged) - totalPop(world())) < 1e-6)
})
test('propaganda (fast): bounded, never overshoots the ideal, reversible past the baseline sign, competing pushes add', () => {
  const s = world(), cell = s.polity.cells[K('peasants')]; cell.pref = { extraction_investment: -0.5 }; const c = ctxOf(s)
  pushPreference(c, cell, { extraction_investment: 0.9 }, 500); assert.ok(effectivePref(cell, 'extraction_investment') > -0.5)
  for (let i = 0; i < 300; i++) pushPreference(c, cell, { extraction_investment: 0.9 }, 500)
  assert.ok(effectivePref(cell, 'extraction_investment') <= 0.9 + 1e-9 && effectivePref(cell, 'extraction_investment') > 0, 'crossed the baseline sign, stopped at the ideal')
  assert.ok(Math.abs(cell.prefMods.extraction_investment.reduce((a, m) => a + m.value, 0)) <= c.T('pref.modRange') + 1e-9)
  pushPreference(c, cell, { extraction_investment: -0.9 }, 500); assert.ok(effectivePref(cell, 'extraction_investment') < 0.9)
})
test('propaganda commitment: zero-sum with ordinary Teaching/Culture use; Government draws on its amalgam; Teaching moves the baseline; lift ends it', () => {
  let s = world(); s.polity.cells[K('nobles')].labour.Culture = 30; s.polity.cells[K('nobles')].pref = { conservatism_reformism: -0.6 }
  const order = (id, actor, params) => ({ id, actor, type: 'propaganda', params })
  const church = { kind: 'cell', key: K('nobles') }
  let r = resolveTurn(s, ruleset, [order('p0', church, { amount: 99, pool: 'Culture' })], { modules, registry }); assert.equal(r.report.rejected.length, 1, 'more than the free Culture labour is refused')
  r = resolveTurn(s, ruleset, [order('p1', church, { amount: 20, pool: 'Culture', ideal: { conservatism_reformism: 1 }, targets: estate('peasants') })], { modules, registry }); s = r.state
  assert.equal(r.report.executed.length, 1); assert.equal(directedShare(ctxOf(s), K('nobles'), 'Culture'), 20)
  assert.ok(effectivePref(s.polity.cells[K('peasants')], 'conservatism_reformism') > 0, 'target pushed')
  assert.equal(s.polity.log.at(-1).visibility, 'covert')
  const before = effectivePref(s.polity.cells[K('peasants')], 'conservatism_reformism')
  r = resolveTurn(s, ruleset, [{ id: 'l1', actor: church, type: 'liftPropaganda', params: { id: s.commitments[0].id } }], { modules, registry }); s = r.state
  assert.equal(s.commitments.length, 0); assert.ok(effectivePref(s.polity.cells[K('peasants')], 'conservatism_reformism') < before + 1e-9, 'stops pushing; the stack decays')
  // Government justification: ideal defaults to the Weight-weighted amalgam
  const g = resolveTurn(world(), ruleset, [order('g1', gov, { amount: 5 })], { modules, registry }).state
  assert.ok(g.commitments[0].params.ideal === undefined && g.commitments.length === 1)
  // education (Teaching) moves the durable baseline
  const w = world(); w.polity.cells[K('nobles')].labour.Teaching = 40; w.polity.cells[K('peasants')].pref = { fervor_secular: 0 }
  const e = run(w, [order('e1', church, { amount: 40, pool: 'Teaching', ideal: { fervor_secular: 1 }, targets: estate('peasants') })], 1)
  assert.ok(e.polity.cells[K('peasants')].pref.fervor_secular > 0, 'baseline moved')
})
test('counterPropaganda: a pushed cell with free Culture labour pulls itself back toward its baseline', () => {
  const s = world(), p = s.polity.cells[K('peasants')]; p.labour.Culture = 50; p.pref = { extraction_investment: 0 }; pushPreference(ctxOf(s), p, { extraction_investment: 1 }, 800)
  s.polity.rung = { [`${K('peasants')}|subsistence`]: 1 }; p.grievance = { subsistence: 0.2 }
  const c = ctxOf(s), acts = modules.find(m => m.id === 'polity').decideCellActions(c).filter(a => a.actor.key === K('peasants'))
  const cp = acts.find(a => a.type === 'counterPropaganda'); assert.ok(cp, `acts ${acts.map(a => a.type)}`)
  const before = effectivePref(p, 'extraction_investment'); registry.get('counterPropaganda').apply(c, cp); assert.ok(effectivePref(p, 'extraction_investment') < before)
})
test('Teaching: moves labour toward the Profile, conserves headcount, never past target, committed labour untouched, extinct pools unreachable', () => {
  const s = world(), cell = s.polity.cells[K('peasants')]
  cell.labour = { Agriculture: 900, Teaching: 99, Mining: 1 }; cell.labourCommitted = { Agriculture: 100 }; cell.laborProfile = { Agriculture: 0.5, Mining: 0.3, Culture: 0.1, Teaching: 0.099 }
  s.polity.cells[K('k', 'peasants')] = undefined; delete s.polity.cells[K('k', 'peasants')]
  const total = () => Object.values(cell.labour).reduce((a, b) => a + b, 0), t0 = total(), c = ctxOf(s)
  const moved = teachCell(c, cell.key); assert.ok(Math.abs(moved - 99 * 0.02) < 1e-9, `moved ${moved}`)
  assert.ok(Math.abs(total() - t0) < 1e-9); assert.equal(cell.labour.Culture ?? 0, 0, 'Culture is extinct country-wide: unreachable')
  for (let i = 0; i < 600; i++) stepTeaching(ctxOf(s))
  assert.ok(Math.abs(cell.labour.Mining - 300) < 1e-6, `Mining ${cell.labour.Mining}`); assert.ok(cell.labour.Agriculture >= 500 - 1e-6 && cell.labour.Agriculture >= 100 - 1e-9)
  assert.ok(cell.flow.teaching >= 0)
})
test('Teaching: Nation affinity biases the split; directed Teaching removes retraining capacity', () => {
  const mk = () => { const s = world(); delete s.polity.cells[K('k', 'peasants')]; const c = s.polity.cells[K('peasants')]; c.labour = { Agriculture: 800, Teaching: 200, Mining: 1, Cavalry: 1 }; c.laborProfile = { Agriculture: 0.2, Mining: 0.4, Cavalry: 0.4, Teaching: 0.2 }; return s }
  const s = mk(); s.nations.affinity = { v: { Mining: 3 } }; const c = s.polity.cells[K('peasants')]; teachCell(ctxOf(s), c.key)
  assert.ok(c.labour.Mining - 1 > c.labour.Cavalry - 1, 'Mining affinity x3')
  const s2 = mk(); s2.commitments.push({ id: 'x', actor: { kind: 'cell', key: K('peasants') }, type: 'propaganda', params: { pool: 'Teaching', amount: 200 } })
  assert.equal(teachCell(ctxOf(s2), K('peasants')), 0, 'all teachers directed at education')
})
test('demo scenario, 25 turns with Mobility + Demotion + propaganda ordered: invariants hold and runs are deterministic', async () => {
  const readJson = async p => JSON.parse(readFileSync(new URL('../' + p, import.meta.url)))
  const play = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); c.ruleset.tuning['pop.growth'] = { value: 0, status: 'placeholder' }   // conservation check: no natural growth
    const V = { kind: 'government', country: 'vantiria' }, ests = [...new Set(Object.values(c.state.polity.cells).map(x => x.estate))]
    const pop0 = Object.values(c.state.polity.cells).reduce((a, x) => a + x.population, 0)
    await c.submit({ actor: V, type: 'reformRightsDuties', params: { entries: [{ kind: 'rights', id: 'EstateMobility', scope: { kind: 'estate', estate: 'peasants' }, value: 0.5 }, { kind: 'duties', id: 'Demotion', scope: { kind: 'estate', estate: 'nobility' }, value: 0.5 }] } })
    await c.submit({ actor: V, type: 'setMobilityGap', params: { from: 'peasants', to: 'nobility', gap: 99 } })
    await c.submit({ actor: V, type: 'propaganda', params: { amount: 5, ideal: { extraction_investment: 0.5 }, targets: { kind: 'empire' } } })
    for (let i = 0; i < 25; i++) { await c.endTurn()
      for (const x of Object.values(c.state.polity.cells)) { assert.ok(x.wealth >= 0 && x.population >= 0); for (const v of Object.values(x.grievance)) assert.ok(v >= 0 && v <= 1) } }
    return { c, pop0, ests } }
  const a = await play(), b = await play()
  assert.equal(JSON.stringify(a.c.state), JSON.stringify(b.c.state), 'deterministic')
  assert.ok(Math.abs(Object.values(a.c.state.polity.cells).reduce((s, x) => s + x.population, 0) - a.pop0) < 1e-3, 'no population created or destroyed (no growth yet)')
  assert.ok(Object.values(a.c.state.polity.cells).some(x => (x.prefMods?.extraction_investment ?? []).length), 'Government propaganda wrote preference modifiers')
})
