// Internal armed conflict: a faction's armed rung resolved by War — bloc as a war side, rebel muster from the cells' own pools via the scalar Retinue Right,
// rebel supply from held territory, and the three end states (concession, suppression, secession) through the same Peace Conference.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const boot = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); return c }
const V = { kind: 'government', country: 'vantiria' }
const cellIn = (c, country, province) => { const r = c.state.world.regionSnapshot.assignment[province]; return Object.values(c.state.polity.cells).find(x => x.region === r && x.estate === 'peasants' && x.nation === (country === 'vantiria' ? 'vantir' : 'kerin')) }
const W = c => c.state.war, blocsOf = c => Object.values(W(c).blocs ?? {})
const tune = (c, k, v) => { c.ruleset.tuning[k] = { value: v, status: 'placeholder' } }
const totalCommitted = c => Object.values(c.state.polity.cells).reduce((a, x) => a + Object.values(x.labourCommitted ?? {}).reduce((s, v) => s + v, 0), 0)
/** grant the Retinue Right, give a cell an unaddressed top-rung Question, take away the Government's Control so defiance is credible */
function ready(c, { province = 'p:5,5', need = 'identity_autonomy', retinue = 0.5, grant = true } = {}) {
  const cell = cellIn(c, 'vantiria', province)
  if (grant) (c.state.polity.law.vantiria.rights.Retinue ??= []).push({ scope: { kind: 'cell', nation: cell.nation, estate: cell.estate, region: cell.region }, value: retinue, declaredTurn: 0 })
  cell.grievance[need] = 0.95; c.state.polity.rung[`${cell.key}|${need}`] = 4; c.state.polity.momentum[`${cell.key}|${need}`] = 3; c.state.admin.governments.vantiria.controlSupply = 0
  return cell }
async function governmentArmy(c, province, share = 0.9, pool = 'Shock Infantry') {
  const cell = cellIn(c, 'vantiria', province), n = Math.floor((cell.labour[pool] - (cell.labourCommitted[pool] ?? 0)) * share)
  await c.submit({ actor: V, type: 'fieldUnits', params: { originCell: cell.key, composition: { [pool]: n }, at: province } }); await c.endTurn(); return Object.values(W(c).armies).find(a => a.owner === 'vantiria') }

test('no Retinue Right -> no armed rung, however angry; with the Right the cell raises a bloc, a war side that is not a Country', async () => {
  const c = await boot(); ready(c, { grant: false }); await c.endTurn(); assert.equal(blocsOf(c).length, 0)
  const c2 = await boot(), cell = ready(c2); const committed0 = totalCommitted(c2); await c2.endTurn()
  assert.equal(blocsOf(c2).length, 1); const b = blocsOf(c2)[0]
  assert.equal(b.country, 'vantiria'); assert.equal(b.goal, 'independence', 'identity/autonomy grievance -> independence goal'); assert.equal(b.status, 'active')
  const w = W(c2).wars.find(x => x.internal); assert.ok(w && w.a === 'vantiria' && w.b === b.id && w.active, 'internal war record, active at once'); assert.ok(!c2.state.countries[b.id], 'side need not be a Country')
  const armies = Object.values(W(c2).armies).filter(a => a.owner === b.id); assert.ok(armies.length >= 1)
  for (const u of armies.flatMap(a => a.units.map(id => W(c2).units[id]))) { assert.equal(u.originCell, cell.key); assert.ok(u.n > 0) }
  assert.ok(totalCommitted(c2) > committed0, "retinue is committed from the cell's own pools")
  const men = armies.reduce((s, a) => s + a.units.reduce((t, id) => t + W(c2).units[id].n, 0), 0), freeArmy = ['Shock Infantry', 'Pike Infantry', 'Skirmishers', 'Cavalry', 'Artillery', 'Siege Corps'].reduce((s, p) => s + (cell.labour[p] ?? 0), 0)
  assert.ok(men <= 0.5 * freeArmy + 1e-6, 'never more than the scalar Retinue fraction of the own armed pools')
  const held = Object.entries(W(c2).occupations).filter(([, o]) => o.occupier === b.id); assert.ok(held.length >= 1, 'rebels control their home provinces (rebel supply source)')
  assert.equal(c2.state.polity.cells[cell.key].flags.rebel, b.id)
  assert.equal((await c2.query('blocs'))[b.id].status, 'active')
})
test('rebel units fight on the same machinery: they are supplied from held territory and the Government can besiege/retake it', async () => {
  const c = await boot(); tune(c, 'war.siege.turns', 2); const cell = ready(c); await c.endTurn(); const b = blocsOf(c)[0]
  const reb = Object.values(W(c).armies).filter(a => a.owner === b.id)[0]; await c.endTurn()
  for (const id of reb.units) { const u = W(c).units[id]; if (u) assert.ok(u.supply > 0, 'rebel army draws supply from the rebel-held province it stands on') }
  const g = await governmentArmy(c, 'p:7,6', 0.95); assert.ok(g, 'Government army fielded')
  const target = reb.position; await c.submit({ actor: V, type: 'orderMove', params: { armyId: g.id, to: target } })
  for (let i = 0; i < 40 && blocsOf(c)[0].status === 'active'; i++) await c.endTurn()
  assert.ok(W(c).score.some(e => e.cause === 'battle'), 'a battle was fought'); assert.notEqual(blocsOf(c)[0].status, 'active', `bloc resolved: ${blocsOf(c)[0].status}`)
})
test('suppression: rebels destroyed -> war ends, held provinces released, retinue labour released, martial law on the member cells costs Control and expires', async () => {
  const c = await boot(); tune(c, 'war.siege.turns', 2); const cell = ready(c, { retinue: 0.13 }); await c.endTurn()
  const b = blocsOf(c)[0]; assert.ok(b && b.status === 'active')
  tune(c, 'civil.calm.turns', 999); tune(c, 'war.siege.defRate', 0.01)                                                // isolate suppression from the grievance-addressed end
  const g = await governmentArmy(c, 'p:7,6', 0.95)
  for (let i = 0; i < 80 && blocsOf(c)[0].status === 'active'; i++) {            // the Government marches on whatever the rebels still hold (the AI does the same)
    const ga = W(c).armies[g.id]; if (!ga?.path?.length) { const targets = [...Object.values(W(c).armies).filter(a => a.owner === b.id).map(a => a.position), ...Object.keys(W(c).occupations).filter(p => W(c).occupations[p].occupier === b.id)].filter(p => p !== ga?.position)
      if (targets[0] && ga) await c.submit({ actor: V, type: 'orderMove', params: { armyId: g.id, to: targets[0] } }) }
    await c.endTurn() }
  const fin = blocsOf(c)[0]; assert.equal(fin.status, 'suppressed'); const w = W(c).wars.find(x => x.internal); assert.equal(w.active, false); assert.equal(w.result, 'suppressed')
  assert.ok(!Object.values(W(c).occupations).some(o => o.occupier === fin.id), 'no province left in rebel hands')
  const mem = c.state.polity.cells[cell.key] ?? Object.values(c.state.polity.cells).find(x => x.flags?.martialLaw)
  assert.ok(mem.flags.martialLaw, 'martial law on the suppressed cells'); assert.ok(!mem.flags.rebel)
  assert.ok(c.ctx().derive.war.martialCost('vantiria') > 0, 'martial law costs Control (the same cost occupation uses)')
  for (const x of Object.values(c.state.polity.cells)) for (const v of Object.values(x.labourCommitted ?? {})) assert.ok(v >= -1e-9)
  const wait = mem.flags.martialLaw.until + 2 - c.state.meta.turn; for (let i = 0; i < wait; i++) await c.endTurn()
  assert.ok(!Object.values(c.state.polity.cells).some(x => x.flags?.martialLaw), 'martial law lapses'); assert.equal(c.ctx().derive.war.martialCost('vantiria'), 0)
})
test('concession: the Government offers Rights/Duties terms at the Peace Conference; accepted -> entries applied, armies disbanded, war ended; an empty offer to independence-seekers is refused', async () => {
  const c = await boot(); tune(c, 'civil.concession', 6); const cell = ready(c); await c.endTurn(); const b = blocsOf(c)[0], w = W(c).wars.find(x => x.internal)
  await c.submit({ actor: V, type: 'proposePeace', params: { war: w.id, terms: { concessions: [] } } }); await c.endTurn()
  assert.equal(W(c).wars.find(x => x.internal).lastProposal.accepted, false, 'independence-seekers refuse an empty offer'); assert.equal(blocsOf(c)[0].status, 'active')
  const entries = [{ kind: 'rights', id: 'Council', scope: { kind: 'estate', estate: 'peasants' }, value: true }, { kind: 'duties', id: 'Taxation', scope: { kind: 'estate', estate: 'peasants' }, value: { market: 0, wealth: 0 } }]
  const committed = totalCommitted(c); await c.submit({ actor: V, type: 'proposePeace', params: { war: w.id, terms: { concessions: entries } } }); await c.endTurn()
  const fin = blocsOf(c)[0]; assert.equal(fin.status, 'conceded'); assert.equal(W(c).wars.find(x => x.internal).active, false)
  assert.equal(c.ctx().derive.polity.right(cell.key, 'Council'), true, 'the concession is now law'); assert.deepEqual(c.ctx().derive.polity.duty(cell.key, 'Taxation'), { market: 0, wealth: 0 })
  assert.equal(Object.values(W(c).armies).filter(a => a.owner === b.id).length, 0); assert.ok(totalCommitted(c) < committed, 'retinue returned to its cells')
  assert.ok(!Object.values(W(c).occupations).some(o => o.occupier === b.id))
})
test('concession by grievance addressed: if every member cell calms (rung 0) for civil.calm.turns the conflict ends without terms', async () => {
  const c = await boot(); tune(c, 'civil.calm.turns', 2); tune(c, 'civil.revolt', 3); const cell = ready(c, { need: 'fairness' }); await c.endTurn(); assert.equal(blocsOf(c)[0].goal, 'concession')
  for (let i = 0; i < 6 && blocsOf(c)[0].status === 'active'; i++) { for (const x of Object.values(c.state.polity.cells)) if (x.flags?.rebel) { x.grievance = {}; for (const k of Object.keys(c.state.polity.rung)) if (k.startsWith(x.key + '|')) c.state.polity.rung[k] = 0; for (const k of Object.keys(c.state.polity.momentum)) if (k.startsWith(x.key + '|')) c.state.polity.momentum[k] = 0 }
    await c.endTurn() }
  assert.equal(blocsOf(c)[0].status, 'conceded')
})
test('secession: holding all home provinces free of Government armies for civil.secede.turns forms a new Country (Formation); armies and provinces pass to it; the world keeps running', async () => {
  const c = await boot(); tune(c, 'civil.secede.turns', 2); const cell = ready(c); await c.endTurn(); const b = blocsOf(c)[0], heldBefore = Object.keys(W(c).occupations).filter(p => W(c).occupations[p].occupier === b.id)
  for (let i = 0; i < 6 && blocsOf(c)[0].status === 'active'; i++) await c.endTurn()
  const fin = blocsOf(c)[0]; assert.equal(fin.status, 'seceded'); const nid = fin.country2; assert.ok(c.state.countries[nid], 'new Country exists'); assert.equal(c.state.countries[nid].formedFrom, 'vantiria')
  for (const p of heldBefore) assert.equal(c.state.world.provinces[p].owner, nid)
  assert.ok(Object.values(W(c).armies).every(a => a.owner !== b.id)); assert.ok(c.state.polity.law[nid]); assert.ok(c.state.admin.governments[nid])
  const w = W(c).wars.find(x => x.internal); assert.equal(w.result, 'seceded'); assert.equal(w.active, false)
  for (let i = 0; i < 5; i++) await c.endTurn()                                   // Regions re-derive, economy/polity keep running with the new owner
  assert.ok(Object.values(c.state.polity.cells).some(x => c.ctx().derive.worldmap.regionOwner(x.region) === nid), 'cells of the new Country exist after Region re-derivation')
  for (const x of Object.values(c.state.polity.cells)) { assert.ok(x.wealth >= 0 && x.population >= 0) }
})
test('peace terms that grant secession form the Country too (Formation is a peace-conference outcome)', async () => {
  const c = await boot(); tune(c, 'civil.secedeValue', 6); ready(c); await c.endTurn(); const w = W(c).wars.find(x => x.internal)
  await c.submit({ actor: V, type: 'proposePeace', params: { war: w.id, terms: { secede: true } } }); await c.endTurn()
  const fin = blocsOf(c)[0]; assert.equal(fin.status, 'seceded'); assert.ok(c.state.countries[fin.country2])
})
test('an AI Government fights the bloc with the same Action API; whole run deterministic, no negative stocks', async () => {
  const play = async () => { const c = await boot(); c.state.countries.vantiria.isPlayer = false; c.state.countries.kerinia.isPlayer = true; tune(c, 'civil.secede.turns', 99); ready(c); for (let i = 0; i < 18; i++) await c.endTurn(); return c }
  const a = await play(), b = await play(); assert.equal(JSON.stringify(a.state), JSON.stringify(b.state))
  assert.ok(Object.values(W(a).armies).some(x => x.owner === 'vantiria') || blocsOf(a)[0].status !== 'active', 'the AI raised an army against the bloc (or the revolt is already over)')
  for (const x of Object.values(a.state.polity.cells)) { assert.ok(x.wealth >= 0 && x.population >= 0); for (const v of Object.values(x.labourCommitted ?? {})) assert.ok(v >= -1e-9) }
})
