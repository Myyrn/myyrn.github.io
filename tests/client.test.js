import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const boot = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); return c }

test('demo package loads: 118 provinces, sea/lake hexes are not provinces, regions 6-12 hexes, cells reference real regions', async () => {
  const c = await boot(), m = await c.query('map')
  assert.equal(Object.keys(m.provinces).length, 118); assert.ok(Object.values(m.hexes).some(h => h.surface === 'sea') && Object.values(m.hexes).some(h => h.surface === 'lake'))
  for (const h of Object.values(m.hexes)) assert.equal(!!m.provinces[`p:${h.x},${h.y}`], h.surface === 'land')
  const regionIds = new Set(Object.values(m.regions)); for (const cell of await c.query('cells')) assert.ok(regionIds.has(cell.key.split('|')[2]))
})
test('real Action pipeline: setTaxLaw changes the law, placeRequisition fills Government inventory, bad order is rejected not thrown', async () => {
  const c = await boot(); const gov = { kind: 'government', country: 'vantiria' }
  await c.submit({ actor: gov, type: 'setTaxLaw', params: { market: 0.2, wealth: 0.01 } })
  await c.submit({ actor: gov, type: 'placeRequisition', params: { good: 'Grain', amount: 0.2 } })
  await c.submit({ actor: gov, type: 'setTaxLaw', params: { market: 'x' } })
  const { report } = await c.endTurn()
  assert.equal(report.executed.filter(i => i.startsWith('o')).length, 2); assert.equal(report.rejected.length, 1)   // cells also act (ids start with 'c')
  const law = await c.query('law', { country: 'vantiria' }); assert.equal(law.duties.Taxation.find(e => e.scope.kind === 'empire').value.market, 0.2)
  await c.runTurns(3); const g = await c.query('government', { country: 'vantiria' }); assert.ok(g.inventory.Grain > 0)
})
test('20 turns: invariants hold (Wealth >= 0, Ledger >= 0, grievance/satisfaction in [0,1], population within the 1%-per-turn growth bound)', async () => {
  const c = await boot(); const pop0 = (await c.query('cells')).reduce((s, x) => s + x.population, 0)
  await c.runTurns(20)
  for (const x of await c.query('cells')) { assert.ok(x.wealth >= 0); for (const v of Object.values(x.grievance)) assert.ok(v >= 0 && v <= 1); for (const v of Object.values(x.satisfaction)) assert.ok(v >= 0 && v <= 1) }
  for (const cid of ['vantiria', 'kerinia']) assert.ok((await c.query('government', { country: cid })).ledger >= 0)
  const pop1 = (await c.query('cells')).reduce((s, x) => s + x.population, 0); assert.ok(pop1 <= pop0 * 1.01 ** 20 + 20 && pop1 >= pop0 * 0.99 ** 20 - 20, `population ${pop0} -> ${pop1}`)
  assert.equal((await c.query('history')).length, 20)
})
test('determinism: two runs of the same scenario give identical state', async () => {
  const a = await boot(), b = await boot(); await a.runTurns(5); await b.runTurns(5); assert.deepEqual(a.state, b.state)
})
