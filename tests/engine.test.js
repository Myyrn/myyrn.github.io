import test from 'node:test'
import assert from 'node:assert/strict'
import { ActionRegistry, resolveTurn, schedule } from '../src/engine/engine.js'

const ruleset = { tuning: { 'stance.approve': { value: 0 } } }
const mkState = () => ({ meta: { turn: 0, rng: 7, seq: 0 }, pending: [], polity: { log: [] }, counter: 0, flags: {} })
const registry = new ActionRegistry()
registry.register({ id: 'bump', gateDomain: () => null, validate: () => ({ ok: true }), costs: () => [], apply: (ctx, a) => { ctx.state.counter += a.params.n } })
registry.register({ id: 'tax', gateDomain: () => 'tax-law', validate: () => ({ ok: true }), costs: () => [], defaultVisibility: 'public', apply: ctx => { ctx.state.flags.taxed = true } })
registry.register({ id: 'declare', gateDomain: () => null, costs: () => [], apply: ctx => { schedule(ctx, { dueStep: 7, kind: 'warDeclared', payload: {} }); schedule(ctx, { dueTurnOffset: 1, dueStep: 4, kind: 'hostilities', payload: {} }) } })
let refuse = true
const polity = { id: 'polity', gateHolders: () => ['cellX'], stanceFns: () => ({ selfInterest: () => (refuse ? -1 : 1), modifier: () => 1 }),
  entitlementLoss: (ctx, holders) => { ctx.state.flags.loss = holders }, decideCellActions: () => [] }
const econ = { id: 'economics', steps: { 3: ctx => { ctx.state.counter += 100 }, 1: ctx => { ctx.state.flags.shock = ctx.rng.next() } },
  handlers: { warDeclared: ctx => { ctx.state.flags.war = true }, hostilities: ctx => { ctx.state.flags.hostile = true } } }
const modules = [econ, polity]
const act = (id, type, params = {}, extra = {}) => ({ id, actor: { kind: 'government', country: 'C' }, type, params, ...extra })

test('resolveTurn is pure and deterministic; steps run in order; RNG only advances state', () => {
  const s0 = mkState(), snap = JSON.stringify(s0)
  const a = resolveTurn(s0, ruleset, [act('a1', 'bump', { n: 5 })], { modules, registry })
  assert.equal(JSON.stringify(s0), snap)                              // input untouched
  const b = resolveTurn(s0, ruleset, [act('a1', 'bump', { n: 5 })], { modules, registry })
  assert.deepEqual(a.state, b.state)
  assert.equal(a.state.counter, 105); assert.equal(a.state.meta.turn, 1)
  assert.equal(a.state.polity.log.length, 1); assert.equal(a.state.polity.log[0].action_type, 'bump')
})
test('gating: refusal blocks; forceThroughControl executes and registers entitlement loss', () => {
  refuse = true
  const r1 = resolveTurn(mkState(), ruleset, [act('t1', 'tax')], { modules, registry })
  assert.equal(r1.report.refused.length, 1); assert.equal(r1.state.flags.taxed, undefined); assert.equal(r1.state.polity.log.length, 0)
  const r2 = resolveTurn(mkState(), ruleset, [act('t1', 'tax', {}, { forceThroughControl: true })], { modules, registry })
  assert.equal(r2.state.flags.taxed, true); assert.deepEqual(r2.state.flags.loss, ['cellX']); assert.equal(r2.report.entitlementLosses.length, 1)
  refuse = false
  const r3 = resolveTurn(mkState(), ruleset, [act('t1', 'tax')], { modules, registry })
  assert.equal(r3.state.flags.taxed, true); assert.equal(r3.report.entitlementLosses.length, 0)
})
test('scheduler: war declaration resolves at step 7 now and hostilities at step 4 next turn', () => {
  const t1 = resolveTurn(mkState(), ruleset, [act('d', 'declare')], { modules, registry })
  assert.equal(t1.state.flags.war, true); assert.equal(t1.state.flags.hostile, undefined)
  const t2 = resolveTurn(t1.state, ruleset, [], { modules, registry })
  assert.equal(t2.state.flags.hostile, true); assert.equal(t2.state.pending.length, 0)
})
test('registry rejects threshold-bound types without targetScale', () => {
  assert.throws(() => new ActionRegistry().register({ id: 'espionage', thresholdBound: true }))
})
