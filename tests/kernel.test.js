import test from 'node:test'
import assert from 'node:assert/strict'
import { cellKey } from '../src/kernel/ids.js'
import { covers, cellsCovered, specificity, resolveState, resolveAmount } from '../src/kernel/scope.js'
import { makeStack, value, push, tick } from '../src/kernel/modifiers.js'
import { resolveAllocation, grantFor } from '../src/kernel/allocation.js'
import { applyThreshold, threshold } from '../src/kernel/threshold.js'
import { ClaimLedger } from '../src/kernel/claims.js'
import { makeRng } from '../src/kernel/rng.js'

const cells = ['v|noble|r1', 'v|peas|r1', 'v|peas|r2', 'k|peas|r1'].map(k => k)
const ctx = { country: 'C', cellKeys: () => cells, cellCountry: () => 'C', T: k => ({ 'eps.modifier': 1e-4, 'd.rate': 0.5 })[k] ?? 0.1, decayFns: {} }

test('scope coverage and specificity (Region broader than Estate/Nation)', () => {
  assert.deepEqual(cellsCovered({ kind: 'estate', estate: 'peas' }, ctx), ['v|peas|r1', 'v|peas|r2', 'k|peas|r1'])
  assert.equal(cellsCovered({ kind: 'empire' }, ctx).length, 4)
  assert.ok(specificity({ kind: 'estate' }) > specificity({ kind: 'region' }))
  assert.ok(specificity({ kind: 'nationRegion' }) > specificity({ kind: 'nation' }))
})
test('Rights resolve by most specific scope; Estate vs Nation tie -> latest declared; silence undefined', () => {
  const k = 'v|peas|r1'
  assert.equal(resolveState([], k, ctx), undefined)
  const e = [{ scope: { kind: 'region', region: 'r1' }, value: 'region', declaredTurn: 9 },
             { scope: { kind: 'estate', estate: 'peas' }, value: 'estate', declaredTurn: 2 },
             { scope: { kind: 'nation', nation: 'v' }, value: 'nation', declaredTurn: 5 }]
  assert.equal(resolveState(e, k, ctx), 'nation')          // tie at specificity 2 -> latest
  e.push({ scope: { kind: 'cell', nation: 'v', estate: 'peas', region: 'r1' }, value: 'cell', declaredTurn: 1 })
  assert.equal(resolveState(e, k, ctx), 'cell')
})
test('Control stacks additively', () => {
  const a = [{ scope: { kind: 'estate', estate: 'peas' }, amount: 10 }, { scope: { kind: 'region', region: 'r1' }, amount: 5 }]
  assert.equal(resolveAmount(a, 'v|peas|r1', ctx), 15)
  assert.equal(resolveAmount(a, 'v|noble|r1', ctx), 5)
})
test('ModifierStack decays, has no spend', () => {
  const s = push(makeStack(0.2, -1, 1), { id: 'm', value: 0.4, decay: { kind: 'exp', rateKey: 'd.rate' }, turn: 0 })
  assert.ok(Math.abs(value(s) - 0.6) < 1e-9); tick(s, ctx); assert.ok(Math.abs(value(s) - 0.4) < 1e-9)
  assert.equal(typeof s.spend, 'undefined')
})
test('Allocation Dial: floors by priority, shortfall truncates lowest, surplus by ratio, cap overflow redistributes', () => {
  const dial = { entries: [
    { target: { kind: 'estate', estate: 'peas' }, floor: 10, priority: 1, surplusWeight: 0 },          // 3 cells x 10 = 30
    { target: { kind: 'cell', nation: 'v', estate: 'noble', region: 'r1' }, floor: 0, priority: 2, surplusWeight: 1, cap: 5 },
    { target: { kind: 'nation', nation: 'k' }, floor: 0, priority: 3, surplusWeight: 3 } ] }
  const r = resolveAllocation(dial, 100, ctx)
  assert.equal(grantFor(r, 'v|peas|r1'), 10)
  assert.equal(grantFor(r, 'v|noble|r1'), 5)                     // capped
  // surplus 70: noble weight1 cap5 -> overflow to k|peas|r1 (also hit by estate entry: 10 floor + surplus)
  assert.ok(Math.abs(grantFor(r, 'k|peas|r1') - (10 + 65)) < 1e-6)
  assert.ok(Math.abs(r.leftover) < 1e-6)
  const short = resolveAllocation(dial, 20, ctx)                  // 30 floors > 20: priority-1 tier truncated pro rata
  assert.ok(Math.abs(grantFor(short, 'v|peas|r1') - 20 / 3) < 1e-9)
  assert.equal(short.waterline.priority, 1)
})
test('Spending dial: reserve floor protects balance from discretionary; mandatory may dip; sink keeps', () => {
  const dial = { reserve: 40, sink: 'keep', entries: [
    { target: { kind: 'item', id: 'upkeep' }, floor: 70, priority: 1, mandatory: true },
    { target: { kind: 'item', id: 'subsidy' }, floor: 30, priority: 2, surplusWeight: 1 } ] }
  const r = resolveAllocation(dial, 100, ctx)
  assert.equal(grantFor(r, 'item:upkeep'), 70)
  assert.equal(grantFor(r, 'item:subsidy'), 0)                    // 30 left < reserve 40 -> discretionary gets nothing
  assert.equal(r.leftover, 30)
  const rich = resolveAllocation(dial, 200, ctx)
  assert.equal(grantFor(rich, 'item:subsidy'), 30 + (200 - 70 - 30 - 40))   // floor + surplus above reserve
})
test('Threshold binary, no refund; types must declare targetScale', () => {
  assert.deepEqual(applyThreshold(5, 10), { met: false, effect: 'none', refunded: false })
  assert.equal(applyThreshold(50, 10).used, 10)
  assert.throws(() => threshold({ id: 'x' }, 't', {}, ctx))
})
test('ClaimLedger is zero-sum and all-or-nothing', () => {
  const L = new ClaimLedger(() => 10); const res = { kind: 'pool', holder: 'c', pool: 'Bureaucrats' }
  assert.ok(L.lockAll([{ res, amount: 6 }])); assert.ok(!L.lockAll([{ res, amount: 3 }, { res, amount: 3 }]))
  assert.equal(L.committed(res), 6)
})
test('Rng deterministic and resumable', () => {
  const a = makeRng(42), b = makeRng(42); const xs = [a.next(), a.next()]; assert.deepEqual(xs, [b.next(), b.next()])
  const c = makeRng(a.state()); assert.equal(c.next(), a.next())
})

import { validate, fillDefaults, placeholders } from '../src/kernel/schema.js'
const goodsField = { type: 'record', item: { type: 'object', fields: {
  tier: { type: 'enum', values: ['raw', 'semi', 'light', 'heavy', 'transport'], required: true },
  baseValue: { type: 'float', min: 0, default: 1, status: 'placeholder' },
  extractPool: { type: 'ref', ref: 'pools' } } } }
test('schema: validates types/enums/refs, fills defaults, lists placeholders', () => {
  const refs = { pools: new Set(['Agriculture', 'Mining']) }
  const doc = { Grain: { tier: 'raw', baseValue: 0.2, extractPool: 'Agriculture' }, Bad: { tier: 'x', baseValue: -1, extractPool: 'Nope', extra: 1 } }
  const ids = validate(goodsField, doc, '/goods', refs).map(i => `${i.id}@${i.path}`).sort()
  assert.deepEqual(ids, ['enum@/goods/Bad/tier', 'range@/goods/Bad/baseValue', 'ref@/goods/Bad/extractPool', 'unknownKey@/goods/Bad/extra'])
  assert.equal(fillDefaults(goodsField, { Salt: { tier: 'raw' } }).Salt.baseValue, 1)
  assert.deepEqual(placeholders(goodsField, doc), ['/Grain/baseValue', '/Bad/baseValue'])
})

test("schema: 'any' type accepts anything", () => {
  assert.deepEqual(validate({ type: 'any' }, { x: 1 }, '/a'), [])
})
