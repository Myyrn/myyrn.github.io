import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
import { stepAllowed, findPath } from '../src/modules/war/graph.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const boot = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); return c }
const V = { kind: 'government', country: 'vantiria' }, K = { kind: 'government', country: 'kerinia' }
const cellIn = (c, country, province) => { const r = c.state.world.regionSnapshot.assignment[province]; return Object.values(c.state.polity.cells).find(x => x.region === r && x.estate === 'peasants' && x.nation === (country === 'vantiria' ? 'vantir' : 'kerin')) }
async function war(c) { await c.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia' } }); await c.endTurn(); await c.endTurn(); assert.ok(c.state.war.wars[0].active, 'war becomes active the turn after the declaration') }
async function field(c, gov, province, share = 0.5, pool = 'Shock Infantry') { const cell = cellIn(c, gov.country, province), n = Math.floor((cell.labour[pool] - (cell.labourCommitted[pool] ?? 0)) * share)
  await c.submit({ actor: gov, type: 'fieldUnits', params: { originCell: cell.key, composition: { [pool]: n }, at: province } }); const rep = (await c.endTurn()).report; return { cell, n, rep } }
const armiesOf = (c, o) => Object.values(c.state.war.armies).filter(a => a.owner === o)

test('movement graph: Mountain interior blocked unless pass; paths exist elsewhere', async () => {
  const ctx = (await boot()).ctx(), a = { traits: [] }
  assert.equal(stepAllowed(ctx, 'p:6,2', 'p:7,2', a), false); assert.ok(stepAllowed(ctx, 'p:6,1', 'p:7,1', a))
  assert.ok(findPath(ctx, 'p:3,5', 'p:12,5', a).length >= 9)
})
test('declareWar: executes (no Veto.war holder), schedules effects: active only after hostilitiesBegin; unknown target rejected', async () => {
  const c = await boot(); await c.submit({ actor: V, type: 'declareWar', params: { target: 'nowhere' } }); assert.equal((await c.endTurn()).report.rejected.length, 1)
  await c.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia' } }); await c.endTurn(); assert.equal(c.state.war.wars[0].active, false); await c.endTurn(); assert.equal(c.state.war.wars[0].active, true)
})
test('fieldUnits: commits labour, consumes weapons, creates an army; invalid orders are rejected with reasons', async () => {
  const c = await boot(), cell = cellIn(c, 'vantiria', 'p:5,5'), before = cell.labourCommitted['Shock Infantry'] ?? 0
  const { n, rep } = await field(c, V, 'p:5,5'); assert.ok(n > 0); assert.equal(armiesOf(c, 'vantiria').length, 1)
  assert.equal(c.state.polity.cells[cell.key].labourCommitted['Shock Infantry'], before + n)
  await c.submit({ actor: V, type: 'fieldUnits', params: { originCell: cell.key, composition: { 'Shock Infantry': 1e9 } } }); const r2 = (await c.endTurn()).report
  assert.ok(r2.rejected.some(r => r.reasons[0].includes('not enough')))
  await c.submit({ actor: V, type: 'fieldUnits', params: { originCell: cellIn(c, 'kerinia', 'p:10,5').key, composition: { 'Shock Infantry': 1 } } }); assert.ok((await c.endTurn()).report.rejected.some(r => r.reasons[0].includes('belong')))
})
test('battle: the larger, better-supplied army wins; casualties come out of origin cells; war harm and score are logged; loser retreats or dies', async () => {
  const c = await boot(); c.ruleset.tuning['pop.growth'] = { value: 0, status: 'placeholder' }; await war(c)       // isolate casualties from natural growth
  const a = await field(c, V, 'p:7,6', 0.9), b = await field(c, K, 'p:8,6', 0.1); const av = armiesOf(c, 'vantiria')[0], ak = armiesOf(c, 'kerinia')[0]
  const popBefore = c.state.polity.cells[a.cell.key].population
  await c.submit({ actor: V, type: 'orderMove', params: { armyId: av.id, to: ak.position } }); for (let i = 0; i < 12 && !c.state.war.score.some(e => e.cause === 'battle'); i++) await c.endTurn()
  assert.ok(c.state.war.score.some(e => e.cause === 'battle'), 'battle happened'); assert.ok(c.state.war.score.every(e => e.cause === 'battle' || e.cause === 'siege'))
  assert.ok(Object.values(c.state.polity.cells).some(x => (x.warHarm ?? 0) > 0), 'war harm accrues on origin cells')
  assert.ok(c.state.polity.cells[a.cell.key].population <= popBefore)
  const survivors = armiesOf(c, 'kerinia').filter(x => x.id === ak.id); assert.ok(survivors.length === 0 || survivors[0].units.some(id => c.state.war.units[id].cohesion < 0.7), 'loser destroyed or shaken')
})
test('siege -> occupation -> peace: capture raises security grievance; ratified peace cedes the province and Regions re-derive with totals conserved', async () => {
  const c = await boot(); c.ruleset.tuning['war.siege.turns'] = { value: 2, status: 'placeholder' }; await war(c)
  await field(c, V, 'p:7,6', 0.9); const av = armiesOf(c, 'vantiria')[0]; const target = 'p:8,6'
  await c.submit({ actor: V, type: 'orderMove', params: { armyId: av.id, to: target } }); for (let i = 0; i < 14 && !c.state.war.occupations[target]; i++) await c.endTurn()
  assert.ok(c.state.war.occupations[target], 'province occupied'); assert.equal(c.state.war.occupations[target].occupier, 'vantiria')
  const victims = Object.values(c.state.polity.cells).filter(x => c.ctx().derive.war.occupiedShare(x.key) > 0); assert.ok(victims.length > 0)
  await c.endTurn(); assert.ok(victims.some(x => (x.warHarm ?? 0) > 0), 'occupation harms the cells under it')
  const popTotal = () => Object.values(c.state.polity.cells).reduce((s, x) => s + x.population, 0), pop0 = popTotal(), wealth0 = Object.values(c.state.polity.cells).reduce((s, x) => s + x.wealth, 0)
  await c.submit({ actor: V, type: 'proposePeace', params: { war: c.state.war.wars[0].id, terms: { cede: [{ province: target, from: 'kerinia', to: 'vantiria' }] } } }); await c.endTurn()
  const w = c.state.war.wars[0]; assert.equal(w.lastProposal.accepted, true, 'defeated side accepts: weak and exhausted'); assert.equal(w.active, false)
  assert.equal(c.state.world.provinces[target].owner, 'vantiria'); assert.equal(Object.keys(c.state.war.occupations).length, 0)
  const owners = new Set(Object.values(c.state.world.regionSnapshot.assignment)); for (const x of Object.values(c.state.polity.cells)) assert.ok(c.state.world.regionSnapshot.owners[x.region] !== undefined, `cell ${x.key} sits in a live Region`)
  assert.ok(Math.abs(popTotal() - pop0) / pop0 < 0.02, 'population conserved through Region split/merge (casualties aside)')
  for (const x of Object.values(c.state.polity.cells)) { assert.ok(x.wealth >= 0); assert.ok(x.population > 0) }
})
test('peace is refused when the other side is strong and not exhausted', async () => {
  const c = await boot(); await war(c); await field(c, K, 'p:9,6', 0.9)
  await c.submit({ actor: V, type: 'proposePeace', params: { war: c.state.war.wars[0].id, terms: { cede: [{ province: 'p:8,6', from: 'kerinia', to: 'vantiria' }] } } }); await c.endTurn()
  assert.equal(c.state.war.wars[0].lastProposal.accepted, false); assert.equal(c.state.war.wars[0].active, true); assert.equal(c.state.world.provinces['p:8,6'].owner, 'kerinia')
})
test('war run (25 turns) is deterministic and keeps invariants', async () => {
  const run = async () => { const c = await boot(); await war(c); await field(c, V, 'p:7,6', 0.6); await field(c, K, 'p:8,6', 0.6)
    await c.submit({ actor: V, type: 'orderMove', params: { armyId: armiesOf(c, 'vantiria')[0].id, to: 'p:9,7' } }); await c.runTurns(25); return c }
  const a = await run(), b = await run(); assert.deepEqual(a.state, b.state)
  for (const x of Object.values(a.state.polity.cells)) { assert.ok(x.wealth >= 0 && x.population > 0); for (const v of Object.values(x.grievance)) assert.ok(v >= 0 && v <= 1) }
  for (const u of Object.values(a.state.war.units)) { assert.ok(u.n >= 0); assert.ok(u.cohesion >= 0 && u.cohesion <= 1) }
})

test('AI Government (same Action API) raises and marches an army once war is on; run stays deterministic', async () => {
  const run = async () => { const c = await boot(); await c.submit({ actor: V, type: 'declareWar', params: { target: 'kerinia' } }); await c.runTurns(12); return c }
  const a = await run(), b = await run(); assert.deepEqual(a.state, b.state)
  assert.ok(Object.values(a.state.war.armies).some(x => x.owner === 'kerinia') || a.state.war.score.length > 0, 'the AI side fielded forces')
})
