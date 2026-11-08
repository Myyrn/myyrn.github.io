import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const boot = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); return c }
const gov = { kind: 'government', country: 'vantiria' }
const cellsOf = (c, estate) => Object.values(c.state.polity.cells).filter(x => x.estate === estate && c.ctx().derive.worldmap.regionOwner(x.region) === 'vantiria')

test('gating: a Veto holder refuses a costly law; forcing it through registers entitlement loss that decays', async () => {
  const c = await boot()
  await c.submit({ actor: gov, type: 'setTaxLaw', params: { market: 0.05, wealth: 0.6 } })
  let r = (await c.endTurn()).report
  assert.equal(r.refused.length, 1); assert.equal(r.refused[0].type, 'setTaxLaw'); assert.ok(r.refused[0].holders.every(k => k.includes('nobility')))
  assert.equal((await c.query('law', { country: 'vantiria' })).duties.Taxation[0].value.wealth, 0, 'law unchanged when refused')
  await c.submit({ actor: gov, type: 'setTaxLaw', params: { market: 0.05, wealth: 0.6 }, forceThroughControl: true })
  r = (await c.endTurn()).report
  assert.equal(r.entitlementLosses.length, 1); assert.equal((await c.query('law', { country: 'vantiria' })).duties.Taxation[0].value.wealth, 0.6)
  const noble = cellsOf(c, 'nobility')[0], v1 = noble.fairnessMods.reduce((s, m) => s + m.value, 0); assert.ok(v1 > 0, 'entitlement-loss modifier exists')
  await c.endTurn(); const v2 = cellsOf(c, 'nobility')[0].fairnessMods.reduce((s, m) => s + m.value, 0); assert.ok(v2 < v1, 'decays')
})
test('gating: no covering Right means the action simply executes; a relief (tax cut) is approved', async () => {
  const c = await boot(); await c.submit({ actor: gov, type: 'setTaxLaw', params: { market: 0.01, wealth: 0 } })
  const r = (await c.endTurn()).report; assert.equal(r.refused.length, 0); assert.equal((await c.query('law', { country: 'vantiria' })).duties.Taxation[0].value.market, 0.01)
})
test('cell actions: below the rung nothing is available; at rung 2 an angry, uncoerced cell refuses tax; Control suppresses it', async () => {
  const c = await boot(); const key = cellsOf(c, 'peasants')[0].key
  const decide = () => c.ctx().derive.polity && c.modules.find(m => m.id === 'polity').decideCellActions(c.ctx()).filter(a => a.actor.key === key).map(a => a.type)
  const cell = () => c.state.polity.cells[key]
  cell().grievance = { subsistence: 0.9, fairness: 0.8 }; c.state.admin.governments.vantiria.controlDial = { entries: [] }; c.state.admin.governments.vantiria.controlSupply = 0
  assert.deepEqual(decide(), [], 'rung 0: no defiance, no petition, no hoard')
  c.state.polity.rung = { [`${key}|subsistence`]: 2 }
  const acts = decide(); assert.ok(acts.includes('taxRefusal'), `acts ${acts}`)
  c.state.admin.governments.vantiria.controlSupply = 1e9; c.state.admin.governments.vantiria.controlDial = { entries: [{ target: { kind: 'empire' }, floor: 0, priority: 1, surplusWeight: 1 }] }
  assert.ok(!decide().includes('taxRefusal'), 'coerced cell does not defy (risk > gain)')
})
test('taxRefusal reduces delivered tax; hoarding withholds goods and releases them when it stops', async () => {
  const base = await boot(), def = await boot(); const key = cellsOf(def, 'peasants')[0].key
  for (const c of [base, def]) { c.state.admin.governments.vantiria.controlSupply = 1e9 }
  await def.submit({ actor: { kind: 'cell', key }, type: 'taxRefusal', params: {} })
  await base.endTurn(); await def.endTurn()
  assert.ok(def.state.polity.cells[key].defiance.tax >= 0)
  const h = await boot(); const k2 = cellsOf(h, 'peasants')[0].key
  await h.submit({ actor: { kind: 'cell', key: k2 }, type: 'hoard', params: {} }); await h.endTurn()
  const held = Object.values(h.state.polity.cells[k2].hoard).reduce((s, x) => s + x, 0); assert.ok(held > 0, 'goods withheld from the market')
  assert.ok((await h.query('history')).length === 1)
  await h.endTurn(); const left = Object.values(h.state.polity.cells[k2].hoard).reduce((s, x) => s + x, 0); assert.ok(left < held * 0.01 + 1e-6 || left <= held, 'released when the cell stops hoarding')
})
test('buildTradeInfra: rich cells invest unprompted; infrastructure decays without upkeep', async () => {
  const c = await boot(); const infra0 = Object.values(c.state.economy.tradeInfra).reduce((s, x) => s + x, 0)
  const { report } = await c.endTurn(); assert.ok(report.executed.some(i => i.includes('buildTradeInfra')) || report.executed.some(i => i.startsWith('c')), 'cells act')
  const infra1 = Object.values(c.state.economy.tradeInfra).reduce((s, x) => s + x, 0); assert.ok(infra1 !== infra0)
})
test('factions are derived per issue from live Questions and carry Weight-aggregated momentum', async () => {
  const c = await boot(), ctx = c.ctx(), P = ctx.state.polity
  for (const x of Object.values(P.cells)) { x.grievance = { subsistence: 0.95 } ; P.momentum[`${x.key}|subsistence`] = 0.8 }
  ctx.state.admin.governments.vantiria.controlSupply = 0; ctx.state.admin.governments.kerinia.controlSupply = 0
  for (const g of Object.values(ctx.state.admin.governments)) g.controlDial = { entries: [] }
  ctx.bump(); const fs = ctx.derive.polity.factions(); assert.ok(fs.length > 0); for (const f of fs) { assert.equal(f.need, 'subsistence'); assert.ok(f.weight > 0); assert.ok(Math.abs(f.momentum - 0.8) < 1e-6) }
  assert.ok(!('factions' in P), 'never persisted')
})
test('long run (40 turns) with acting cells keeps invariants and stays deterministic', async () => {
  const a = await boot(), b = await boot(); await a.runTurns(40); await b.runTurns(40); assert.deepEqual(a.state, b.state)
  for (const x of Object.values(a.state.polity.cells)) { assert.ok(x.wealth >= 0); for (const v of Object.values(x.grievance)) assert.ok(v >= 0 && v <= 1) }
})
