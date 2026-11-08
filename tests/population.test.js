// Natural growth / decrease: delta = population x 0.01 x f(need satisfaction), mirrored into province stock + Nation presence, capped by density, free labour only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { EngineClient } from '../src/client/engineClient.js'
import { makeCtx } from '../src/engine/engine.js'
import { stepPopulation, growthFactor } from '../src/modules/worldmap/population.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const boot = async () => { const c = new EngineClient(); await c.init(await readPackage(readJson, 'scenarios/demo'), await readJson('data/ruleset.json')); return c }
const X = c => makeCtx(c.state, c.ruleset, { modules: c.modules, registry: c.registry, start: c.state })
const sum = a => a.reduce((s, x) => s + x, 0)
const regionPop = (c, cell) => sum(X(c).derive.worldmap.regionProvinces(cell.region).map(p => c.state.world.provinces[p].population))
const regionPresence = (c, cell) => sum(X(c).derive.worldmap.regionProvinces(cell.region).map(p => c.state.nations.presence[p]?.[cell.nation] ?? 0))
const pick = c => Object.values(c.state.polity.cells).find(x => x.nation === 'vantir' && x.estate === 'peasants')

test('the constant is 0.01 (authored) and f is the shortage of subsistence, else the abundance of comfort', async () => {
  const c = await boot(); assert.deepEqual(c.ruleset.tuning['pop.growth'], { value: 0.01, status: 'authored' })
  assert.equal(growthFactor({ satisfaction: { subsistence: 0.4, comfort: 1 } }), -0.6); assert.equal(growthFactor({ satisfaction: { subsistence: 1, comfort: 0.7 } }), 0.7); assert.equal(growthFactor({}), 0)
})
test('abundance: +1% x comfort satisfaction; the province stock and Nation presence grow by exactly the cell\'s change', async () => {
  const c = await boot(), cell = pick(c); cell.satisfaction = { subsistence: 1, comfort: 1, luxury: 1 }; const pop0 = cell.population, rp0 = regionPop(c, cell), pr0 = regionPresence(c, cell), others = Object.values(c.state.polity.cells).filter(x => x !== cell)
  const otherPops = others.map(x => x.population); for (const o of others) o.satisfaction = { subsistence: 1, comfort: 0, luxury: 0 }
  stepPopulation(X(c)); const d = cell.population - pop0
  assert.ok(Math.abs(d - pop0 * 0.01) < 1e-9, `cell grew ${d}`); assert.ok(Math.abs(regionPop(c, cell) - rp0 - d) < 1e-9); assert.ok(Math.abs(regionPresence(c, cell) - pr0 - d) < 1e-9)
  others.forEach((o, i) => assert.equal(o.population, otherPops[i], 'f = 0 (bare subsistence): no change'))
})
test('shortage: population falls by 1% x the subsistence shortfall, drawn from the Nation\'s presence', async () => {
  const c = await boot(), cell = pick(c); cell.satisfaction = { subsistence: 0.5, comfort: 1, luxury: 1 }; for (const o of Object.values(c.state.polity.cells)) if (o !== cell) o.satisfaction = { subsistence: 1, comfort: 0, luxury: 0 }; const pop0 = cell.population, rp0 = regionPop(c, cell), pr0 = regionPresence(c, cell)
  stepPopulation(X(c)); const d = pop0 - cell.population; assert.ok(Math.abs(d - pop0 * 0.01 * 0.5) < 1e-9)
  assert.ok(Math.abs(rp0 - regionPop(c, cell) - d) < 1e-9); assert.ok(Math.abs(pr0 - regionPresence(c, cell) - d) < 1e-9)
})
test('growth is bounded by max_population_density; Wasteland takes nothing; decrease is never bounded', async () => {
  const c = await boot(), cell = pick(c), ps = X(c).derive.worldmap.regionProvinces(cell.region); cell.satisfaction = { subsistence: 1, comfort: 1, luxury: 1 }
  for (const p of ps) { const pr = c.state.world.provinces[p]; pr.population = pr.maxPopulationDensity * pr.maxArea - 1 }          // 1 head of room per province
  const pop0 = cell.population; stepPopulation(X(c)); assert.ok(cell.population - pop0 <= ps.length + 1e-9, 'limited by the room left')
  for (const p of ps) { const pr = c.state.world.provinces[p]; assert.ok(pr.population <= pr.maxPopulationDensity * pr.maxArea + 1e-9) }
  const c2 = await boot(), cell2 = pick(c2), ps2 = X(c2).derive.worldmap.regionProvinces(cell2.region); cell2.satisfaction = { subsistence: 1, comfort: 1, luxury: 1 }
  for (const p of ps2) c2.state.world.provinces[p].habitability = 'Wasteland'; const q = cell2.population; stepPopulation(X(c2)); assert.ok(cell2.population - q > 0, 'with no habitable province the cell alone changes (no stock to mirror)')
})
test('committed labour (armies, retinues) neither breeds nor starves; free labour scales with the population', async () => {
  const c = await boot(), cell = pick(c); cell.labourCommitted['Shock Infantry'] = cell.labour['Shock Infantry'] * 0.5; const com = cell.labourCommitted['Shock Infantry'], free = cell.labour['Shock Infantry'] - com, agri = cell.labour.Agriculture
  cell.satisfaction = { subsistence: 1, comfort: 1, luxury: 1 }; const phi = (cell.population * 1.01) / cell.population; stepPopulation(X(c))
  assert.equal(cell.labourCommitted['Shock Infantry'], com); assert.ok(Math.abs(cell.labour['Shock Infantry'] - (com + free * phi)) < 1e-9); assert.ok(Math.abs(cell.labour.Agriculture - agri * phi) < 1e-9)
})
test('40 turns of the demo: density ceilings, presence <= population, and the Nation x Region population sums all keep holding', async () => {
  const c = await boot(), gap = () => { const m = {}; for (const x of Object.values(c.state.polity.cells)) m[`${x.nation}|${x.region}`] = (m[`${x.nation}|${x.region}`] ?? 0) + x.population
    return Object.fromEntries(Object.entries(m).map(([k, v]) => { const [n, r] = k.split('|'); return [k, v - regionPresence(c, { nation: n, region: r })] })) }
  const g0 = gap(); const pop0 = sum(Object.values(c.state.polity.cells).map(x => x.population)); await c.runTurns(40)
  for (const [id, p] of Object.entries(c.state.world.provinces)) { if (p.maxPopulationDensity !== undefined) assert.ok(p.population <= p.maxPopulationDensity * p.maxArea * 1.0001, `${id} over its ceiling`)
    assert.ok(sum(Object.values(c.state.nations.presence[id] ?? {})) <= p.population * 1.01 + 1, `${id} presence exceeds population`) }
  const g1 = gap(); for (const k of Object.keys(g0)) if (g1[k] !== undefined) assert.ok(Math.abs(g1[k] - g0[k]) < 1e-4 * (1 + Math.abs(g0[k])) + 1, `${k}: cells vs presence drifted ${g0[k]} -> ${g1[k]}`)
  assert.notEqual(sum(Object.values(c.state.polity.cells).map(x => x.population)), pop0, 'population actually moved')
})
test('pop.growth = 0 switches it off exactly', async () => {
  const c = await boot(); c.ruleset.tuning['pop.growth'] = { value: 0, status: 'placeholder' }; const pop0 = sum(Object.values(c.state.polity.cells).map(x => x.population)); await c.runTurns(5)
  assert.equal(sum(Object.values(c.state.polity.cells).map(x => x.population)), pop0)
})
