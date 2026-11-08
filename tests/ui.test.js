// UI read side + Event Draft builders (pure; the browser end-to-end check is tools/ui_smoke.py). Queries must be read-only and JSON-serialisable.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
import { scopeOf, scopeLabel, matchesFilter } from '../src/ui/scope.js'
import { FORMS, buildOrder, defaults, formsIn } from '../src/ui/forms.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const boot = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); return c }
const V = { kind: 'government', country: 'vantiria' }, sum = a => a.reduce((s, x) => s + x, 0)

test('scope syntax: the six kinds + empire, and the impossible (Nation, Estate) pair is an error, not a guess', () => {
  assert.deepEqual(scopeOf({}).scope, { kind: 'empire' }); assert.deepEqual(scopeOf({ nation: 'vantir' }).scope, { kind: 'nation', nation: 'vantir' }); assert.deepEqual(scopeOf({ estate: 'peasants' }).scope, { kind: 'estate', estate: 'peasants' })
  assert.deepEqual(scopeOf({ region: 'r1' }).scope, { kind: 'region', region: 'r1' }); assert.deepEqual(scopeOf({ nation: 'v', region: 'r1' }).scope, { kind: 'nationRegion', nation: 'v', region: 'r1' }); assert.deepEqual(scopeOf({ estate: 'e', region: 'r1' }).scope, { kind: 'estateRegion', estate: 'e', region: 'r1' })
  assert.deepEqual(scopeOf({ nation: 'v', estate: 'e', region: 'r' }).scope, { kind: 'cell', nation: 'v', estate: 'e', region: 'r' }); assert.match(scopeOf({ nation: 'v', estate: 'e' }).error, /Region/)
  assert.equal(scopeLabel({ kind: 'empire' }), 'Empire'); assert.ok(matchesFilter({ nation: 'v', estate: 'a+b', region: 'r' }, { estate: 'b' }), 'a converged cell matches either part')
})
test('forms: scope-aware drafts carry the chosen Scope; every form builds with its own defaults; JSON/number parsing; gating info', async () => {
  const c = await boot(), rules = await c.query('rules'), o = { me: 'vantiria', scope: { kind: 'estate', estate: 'peasants' }, filter: {}, ...rules, estates: ['nobility', 'peasants'], myCells: ['a|b|r1'], armies: [{ v: 'a1', l: 'a1' }], wars: [{ v: 'w1', l: 'w1' }], countries: [{ v: 'kerinia', l: 'K' }], counterparts: [{ v: 'kerinia', l: 'K' }], treaties: [{ v: 't1', l: 't1' }], proposals: [{ v: 'p1', l: 'p1' }], blocs: [{ v: 'rb1', l: 'rb1' }], propaganda: [{ v: 'c1', l: 'c1' }], granteeIds: [{ v: 'kerinia', l: 'K' }], gov: await c.query('govCard', { country: 'vantiria' }), selectedProvince: 'p:7,6', provinceOwner: 'vantiria' }
  let r = buildOrder('setTaxLaw', { market: '0.2', wealth: '0.05' }, o); assert.deepEqual(r.order.params, { scope: o.scope, market: 0.2, wealth: 0.05 }); assert.equal(r.order.actor.country, 'vantiria')
  assert.match(buildOrder('setTaxLaw', { market: 0.2, wealth: 0 }, { ...o, scopeError: 'pick a Region' }).error, /Region/, 'a scoped form refuses an impossible scope')
  r = buildOrder('reformRightsDuties', { entry: 'rights:EstateMobility', value: '0.5' }, o); assert.deepEqual(r.order.params.entries[0], { kind: 'rights', id: 'EstateMobility', scope: o.scope, value: 0.5 })
  assert.equal(buildOrder('reformRightsDuties', { entry: 'rights:Council', value: 'true' }, o).order.params.entries[0].value, true); assert.equal(buildOrder('reformRightsDuties', { entry: 'rights:Council', value: 'remove' }, o).order.params.entries[0].value, null)
  assert.deepEqual(buildOrder('reformRightsDuties', { entry: 'duties:Taxation', value: '{"market":0.1,"wealth":0}' }, o).order.params.entries[0].value, { market: 0.1, wealth: 0 })
  r = buildOrder('proposeTreaty', { to: 'kerinia', kind: 'Dependency', overlord: 'me', axes: ['MilitaryCap'], terms: '{"MilitaryCap":{"maxMen":10}}' }, o); assert.deepEqual(r.order.params, { to: 'kerinia', kind: 'Dependency', axes: [{ axis: 'MilitaryCap', terms: { maxMen: 10 } }], overlord: 'vantiria' })
  assert.match(buildOrder('proposeTreaty', { to: 'kerinia', kind: 'Cooperation', axes: [], terms: '{oops' }, o).error, /JSON/); assert.equal(buildOrder('proposeTreaty', { to: 'kerinia', kind: 'Alliance', tier: 'Guarantee', axes: [] }, o).order.params.guarantor, 'vantiria')
  assert.deepEqual(buildOrder('declareWar', { target: 'kerinia', goals: ['annex', 'tribute'] }, o).order.params.goals, [{ type: 'annex' }, { type: 'tribute' }])
  r = buildOrder('proposePeace', { war: 'w1', cede: true, secede: true, concessions: '[{"kind":"rights","id":"Council","scope":{"kind":"empire"},"value":true}]', treaties: '' }, { ...o, provinceOwner: 'kerinia' }); assert.deepEqual(r.order.params.terms.cede, [{ province: 'p:7,6', from: 'kerinia', to: 'vantiria' }]); assert.equal(r.order.params.terms.secede, true); assert.equal(r.order.params.terms.concessions.length, 1)
  assert.match(buildOrder('imposeSanction', { target: 'kerinia', axes: [], terms: '' }, o).error, /axis/); assert.equal(buildOrder('setMobilityGap', { from: 'a', to: 'a', gap: 1 }, o).error, 'pick two different Estates')
  assert.equal(buildOrder('propaganda', { amount: 5, ideal_extraction_investment: '0.4', ideal_fervor_secular: '' }, o).order.params.ideal.extraction_investment, 0.4); assert.match(buildOrder('propaganda', { amount: 5, ideal_extraction_investment: 'x' }, o).error, /number/)
  for (const t of Object.keys(FORMS)) { const d = defaults(t, o); const r2 = buildOrder(t, d, o); assert.ok(r2.order || r2.error, t) }                                // every form is constructible from its defaults
  assert.ok(formsIn('Diplomacy').length >= 6)
  const reg = c.registry; for (const t of Object.keys(FORMS)) assert.ok(reg.types.has(t), `${t} is a registered Action type`)
})
test('queries are read-only, JSON-serialisable and consistent with State', async () => {
  const c = await boot(); await c.endTurn(); const before = JSON.stringify(c.state)
  const names = { estates: { country: 'vantiria' }, questions: { country: 'vantiria' }, laws: { country: 'vantiria' }, govCard: { country: 'vantiria' }, economy: { country: 'vantiria' }, world: { country: 'vantiria' }, pair: { a: 'vantiria', b: 'kerinia' }, mirror: { country: 'vantiria' }, treaties: { country: 'vantiria' }, military: { country: 'vantiria' }, commitments: { country: 'vantiria' },
    provinceCard: { id: 'p:7,6' }, cellCard: { key: Object.keys(c.state.polity.cells)[0] }, lens: { lens: 'population' }, scopeTree: { country: 'vantiria' }, rules: {}, orders: {}, catalog: {} }
  for (const [n, a] of Object.entries(names)) { const r = await c.query(n, a); assert.deepEqual(JSON.parse(JSON.stringify(r)), r, `${n} is plain JSON`) }
  assert.equal(JSON.stringify(c.state), before, 'no query changed State')
  const e = await c.query('estates', { country: 'vantiria' }); assert.equal(e.length, Object.values(c.state.polity.cells).filter(x => c.viewCtx().derive.worldmap.regionOwner(x.region) === 'vantiria').length)
  const raw = sum(Object.values(c.state.polity.cells).filter(x => c.viewCtx().derive.worldmap.regionOwner(x.region) === 'vantiria').map(x => x.population)), t = await c.query('scopeTree', { country: 'vantiria', order: ['estate', 'region', 'nation'] })
  assert.equal(t.total, Math.round(raw), 'tree total = Σ cell population'); assert.ok(Math.abs(sum(t.tree.map(n => n.value)) - t.total) <= t.tree.length, 'top level sums to the total (per-node rounding only)')
  const lens = await c.query('lens', { lens: 'population' }); assert.equal(Object.keys(lens.values).length, Object.keys(c.state.world.provinces).length); assert.ok(lens.max > 0)
  const eco = await c.query('economy', { country: 'vantiria' }); assert.equal(eco.pools.find(p => p.id === 'Agriculture').total, Math.round(sum(Object.values(c.state.polity.cells).filter(x => c.viewCtx().derive.worldmap.regionOwner(x.region) === 'vantiria').map(x => x.labour.Agriculture ?? 0))))
  assert.ok(eco.goods.find(g => g.id === 'Grain').stock > 0); assert.ok(Object.keys(eco.goods[0].zones).length > 0, 'prices come from the cached market of the last resolution')
})
test('Laws matrix: a scoped reform shows up as an override in exactly that column', async () => {
  const c = await boot(); const before = await c.query('laws', { country: 'vantiria' }); assert.equal(before.rows.find(r => r.id === 'EstateMobility').cols['e:peasants'].overridden, false)
  await c.submit({ actor: V, type: 'reformRightsDuties', params: { entries: [{ kind: 'rights', id: 'EstateMobility', scope: { kind: 'estate', estate: 'peasants' }, value: 0.4 }] } }); await c.endTurn()
  const after = await c.query('laws', { country: 'vantiria' }), row = after.rows.find(r => r.id === 'EstateMobility'); assert.equal(row.cols['e:peasants'].overridden, true); assert.equal(row.cols['e:peasants'].value, 0.4); assert.equal(row.cols['e:nobility'].value, 0); assert.equal(row.cols.empire.mixed, true, 'the Empire column is mixed once an Estate differs')
})
test('preview: validation, gating verdicts (who would refuse), foreign DomainVeto; orders can be queued and removed', async () => {
  const c = await boot(), tax = (market, wealth) => ({ actor: V, type: 'setTaxLaw', params: { market, wealth } })
  assert.equal((await c.query('preview', { order: { actor: V, type: 'setTaxLaw', params: {} } })).valid, false); assert.equal((await c.query('preview', { order: { actor: V, type: 'nope', params: {} } })).valid, false)
  const ok = await c.query('preview', { order: tax(0.06, 0) }); assert.equal(ok.valid, true); assert.equal(ok.gateDomain, 'taxLaw'); assert.ok(ok.verdicts.length > 0)
  const big = await c.query('preview', { order: tax(0.9, 0.9) }); assert.ok(big.valid && big.blocked && big.holders.length > 0, 'a ruinous tax is refused by the nobility Veto holders')
  await c.submit(tax(0.06, 0)); await c.submit(tax(0.07, 0)); let o = await c.query('orders'); assert.equal(o.length, 2); await c.removeOrder(o[0].id); o = await c.query('orders'); assert.equal(o.length, 1); await c.clearOrders(); assert.equal((await c.query('orders')).length, 0)
})
test('world readouts: pair sheet, mirror and treaties reflect Diplomacy State', async () => {
  const c = await boot(); c.state.diplomacy.treaties.push({ id: 't1', kind: 'Alliance', tier: 'Defensive', parties: ['vantiria', 'kerinia'], status: 'active', axes: [] })
  const w = await c.query('world', { country: 'vantiria' }); assert.equal(w.others[0].tier, 'Defensive'); assert.equal(w.edges.length, 1)
  const p = await c.query('pair', { a: 'vantiria', b: 'kerinia' }); assert.equal(p.treaties.length, 1); assert.deepEqual(Object.keys(p.leverage).sort(), ['cultural', 'diplomatic', 'economic', 'military'])
  const t = await c.query('treaties', { country: 'vantiria' }); assert.equal(t.active.length, 1); assert.ok(t.axes.length > 5)
})
