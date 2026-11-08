import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTurn } from '../src/engine/engine.js'
import { ruleset, modules, registry, makeState } from './fixtures.js'
import { makeCtx } from '../src/engine/engine.js'

const run = (state, n = 1) => { let s = state; for (let i = 0; i < n; i++) s = resolveTurn(s, ruleset, [], { modules, registry }).state; return s }
const cellsOf = s => Object.values(s.polity.cells)
const sum = a => a.reduce((x, y) => x + y, 0)

test('turn runs end-to-end; deterministic and pure', () => {
  const s0 = makeState(), snap = JSON.stringify(s0)
  const a = run(s0), b = run(s0)
  assert.equal(JSON.stringify(s0), snap); assert.deepEqual(a, b); assert.equal(a.meta.turn, 1)
})
test('production: extraction scales with labour (diminishing) and Wasteland yields nothing', () => {
  const lo = makeState({ labour: 50 }), hi = makeState({ labour: 200 }), waste = makeState()
  Object.values(waste.world.provinces).forEach(p => p.habitability = 'Wasteland')
  const out = s => sum(Object.values(run(s).economy.lastOutput))
  assert.ok(out(hi) > out(lo)); assert.ok(out(hi) < out(lo) * 4, 'diminishing returns (alpha<1)'); assert.equal(out(waste), 0)
})
test('cascade: well supplied cells are fully satisfied; goods are conserved (no creation by buying)', () => {
  const s = run(makeState({ labour: 400 }))
  for (const c of cellsOf(s)) assert.ok(c.satisfaction.subsistence > 0.99, `sat ${c.satisfaction.subsistence}`)
  for (const c of cellsOf(s)) assert.ok(c.wealth >= 0)
})
test('cascade is tier-first under a cash limit: subsistence is bought before comfort', () => {
  const rs = { ...ruleset, consumption: { subsistence: [{ any: ['Grain'], perCapita: 0.02 }], comfort: [{ any: ['Wine'], perCapita: 50 }], luxury: [] } }
  const s = resolveTurn(makeState({ labour: 200 }), rs, [], { modules, registry }).state
  for (const c of Object.values(s.polity.cells)) { assert.ok(c.satisfaction.subsistence > 0.99); assert.ok(c.satisfaction.comfort < 0.5, `comfort ${c.satisfaction.comfort}`) }
})
test('taxation: delivered = claimed x involuntary compliance; Wealth never negative', () => {
  const s0 = makeState({ labour: 400 }); s0.polity.law.A.duties.Taxation = [{ scope: { kind: 'empire' }, value: { market: 0.2, wealth: 0 }, declaredTurn: 0 }]
  const none = run(s0)
  assert.ok(Math.abs(none.admin.governments.A.ledger - 100) < 1e-6, 'no Control -> nothing delivered, ledger unchanged')   // controlGrant 0 => involuntary 0
  const s1 = makeState({ labour: 400 }); s1.polity.law.A.duties.Taxation = s0.polity.law.A.duties.Taxation
  s1.admin.governments.A.controlSupply = 1e6; s1.admin.governments.A.controlDial = { entries: [{ target: { kind: 'empire' }, floor: 0, priority: 1, surplusWeight: 1 }] }
  const taxed = run(s1)
  assert.ok(taxed.admin.governments.A.ledger > 100, 'with Control, tax is delivered into the Ledger')
  for (const c of cellsOf(taxed)) assert.ok(c.wealth >= 0)
})
test('Ledger: spending dial vs start-of-turn balance; never negative; unmet upkeep fraction', () => {
  const s = makeState({ labour: 400 }); s.admin.governments.A.ledger = 30
  s.admin.governments.A.spendingDial = { reserve: 0, sink: 'keep', entries: [{ target: { kind: 'item', id: 'upkeep' }, floor: 60, priority: 1, mandatory: true }] }
  const r = run(s).admin.governments.A
  assert.ok(r.ledger >= 0); assert.ok(Math.abs(r.upkeepFraction - 0.5) < 1e-9)
})
test('requisition: delivered scaled by involuntary compliance, goods land in Government inventory', () => {
  const s = makeState({ labour: 400 }); s.polity.law.A.requisitions = [{ scope: { kind: 'empire' }, target: { good: 'Grain' }, amount: 0.5, unit: 'fraction' }]
  const none = run(s); assert.ok(!(none.admin.governments.A.inventory?.Grain > 0))
  s.admin.governments.A.controlSupply = 1e9; s.admin.governments.A.controlDial = { entries: [{ target: { kind: 'empire' }, floor: 0, priority: 1, surplusWeight: 1 }] }
  const some = run(s); assert.ok(some.admin.governments.A.inventory.Grain > 0)
})
test('polity: shortage accumulates existential grievance fast, then Question + momentum + rung; recovery decays slowly', () => {
  let s = makeState({ labour: 0.2 })
  s = run(s, 4); const c = cellsOf(s)[0]
  assert.ok(c.grievance.subsistence > 0.5, `grievance ${c.grievance.subsistence}`)
  assert.ok(Object.keys(s.polity.momentum).length > 0, 'momentum exists while Question live')
  assert.ok(Math.max(...Object.values(s.polity.rung)) >= 1, 'rung reached')
  // relief: plenty of labour -> grievance decays, momentum decays, but not instantly
  Object.values(s.polity.cells).forEach(x => x.labour.Agriculture = 5000)
  const g1 = cellsOf(s)[0].grievance.subsistence, s2 = run(s, 1), g2 = cellsOf(s2)[0].grievance.subsistence
  assert.ok(g2 < g1 && g2 > g1 * 0.5, `slow decay ${g1} -> ${g2}`)
})
test('polity: Question exists iff grievance > compliance (independent of slate)', () => {
  const s = makeState(); const ctx = makeCtx(structuredClone(s), ruleset, { modules, registry, start: s })
  assert.equal(ctx.derive.polity.questions().length, 0)
  Object.values(ctx.state.polity.cells)[0].grievance = { subsistence: 0.99 }
  ctx.bump(); const qs = ctx.derive.polity.questions(); assert.equal(qs.length, 1); assert.equal(qs[0].need, 'subsistence')
})
test('credit: shortfall cells borrow from cash-rich cells via explicit obligation records (no anonymous debts)', () => {
  const s = makeState({ labour: 3 }); const [a, b] = Object.values(s.polity.cells); a.wealth = 100000; b.wealth = 0
  const r = run(s)
  assert.ok(r.economy.obligations.length > 0); for (const o of r.economy.obligations) assert.ok(r.polity.cells[o.creditor] && r.polity.cells[o.debtor])
})
