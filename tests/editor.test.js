import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPackage } from '../src/data/loaders/readPackage.js'
import { validateAll, hasErrors, worklist } from '../src/data/validators/index.js'
import { applyPatches } from '../src/editor/patch.js'
import { EditorStore } from '../src/editor/store.js'
import * as C from '../src/editor/commands.js'
import { seedCells, derivedWaterSource, normalisePresence } from '../src/editor/generators.js'
import { exportBundle, importBundle, savePackage, loadPackage, listPackages } from '../src/editor/bundle.js'
import { newPackage } from '../src/editor/templates.js'
import { EngineClient } from '../src/client/engineClient.js'
const readJson = async path => JSON.parse(readFileSync(new URL('../' + path, import.meta.url)))
const load = async () => { const pkg = await readPackage(readJson, 'scenarios/demo'); return { ...pkg, ruleset: await readJson('data/ruleset.json') } }
const errs = docs => validateAll(docs).filter(i => i.severity === 'error')

test('the demo package validates without errors; the numbers-pass worklist lists placeholders', async () => {
  const docs = await load(); assert.deepEqual(errs(docs), []); assert.ok(worklist(docs).length > 100)
})
test('patch engine: apply then inverse restores the documents exactly (objects and arrays)', async () => {
  const docs = await load(), before = JSON.stringify(docs)
  const inv = applyPatches(docs, [...C.paintTerrain(docs, ['p:3,3', 'p:4,3'], 'Hill'), ...C.setEdge(docs, 'p:3,3', 'p:4,3', 'river'), ...C.setOwner(docs, ['p:5,5'], 'kerinia'), ...C.setTuning(docs, 'prod.k', 2)])
  assert.notEqual(JSON.stringify(docs), before); applyPatches(docs, inv); assert.equal(JSON.stringify(docs), before)
})
test('store: terrain painting clamps forestation, marks provinces manual, undo/redo, and a brush stroke (mergeKey) is ONE undo step', async () => {
  const s = new EditorStore(await load()), ids = ['p:3,3', 'p:4,3', 'p:5,3']
  for (const id of ids) s.apply('paint', C.paintTerrain(s.docs, [id], 'Desert'), { mergeKey: 'stroke1' })
  assert.equal(s.undoStack.length, 1); for (const id of ids) { assert.equal(s.docs.world.provinces[id].terrain, 'Desert'); assert.ok(s.docs.world.provinces[id].forestation <= 10); assert.equal(s.docs.world.provinces[id].provenance, 'manual') }
  assert.ok(s.undo()); for (const id of ids) assert.notEqual(s.docs.world.provinces[id].terrain, 'Desert'); assert.ok(s.redo()); assert.equal(s.docs.world.provinces['p:3,3'].terrain, 'Desert'); assert.ok(s.canUndo && !s.canRedo)
})
test('validators catch broken data with a jump-to path', async () => {
  const s = new EditorStore(await load())
  s.apply('bad owner', C.setOwner(s.docs, ['p:5,5'], 'nowhere')); assert.ok(s.errors.some(i => i.id === 'ref' && i.path.endsWith('/p:5,5/owner')))
  s.undo(); s.apply('far edge', [{ op: 'add', path: '/world/edges/-', value: { a: 'p:3,3', b: 'p:9,9', type: 'river' } }]); assert.ok(s.errors.some(i => i.id === 'edgeAdjacency'))
  s.undo(); s.apply('numeraire', [{ op: 'replace', path: '/ruleset/goods/Refined Precious Metals/baseValue', value: 2 }]); assert.ok(s.errors.some(i => i.id === 'numeraireValue'))
  s.undo(); s.apply('cells', [{ op: 'replace', path: '/polity/cells', value: {} }]); assert.ok(s.errors.some(i => i.id === 'cellSum'))
  s.undo(); s.apply('forest', [{ op: 'replace', path: '/world/provinces/p:3,3/forestation', value: 99 }]); assert.ok(s.warnings.some(i => i.id === 'forestCeiling')); assert.ok(!hasErrors(s.issues))
  s.undo(); s.apply('water province', [{ op: 'replace', path: '/world/hexes/h:3,3/surface', value: 'sea' }]); assert.ok(s.errors.some(i => i.id === 'waterProvince'))
})
test('setSurface to sea removes the province, its presence, warehouse and incident edges; the cell sums then need reseeding', async () => {
  const s = new EditorStore(await load()); s.apply('make sea', C.setSurface(s.docs, 9, 3, 'sea'))
  assert.equal(s.docs.world.provinces['p:9,3'], undefined); assert.equal(s.docs.nations.presence['p:9,3'], undefined); assert.ok(!s.docs.world.edges.some(e => e.a === 'p:9,3' || e.b === 'p:9,3'))
  assert.ok(!s.errors.some(i => i.id === 'waterProvince' || i.id === 'edgeEnds')); s.apply('reseed', seedCells(s.docs)); assert.deepEqual(s.errors, [])
  s.undo(); s.undo(); assert.ok(s.docs.world.provinces['p:9,3'], 'undo restores the province')
})
test('generators: seedCells satisfies the sum constraints; derivedWaterSource follows the precedence (river first); normalisePresence fixes sums', async () => {
  const s = new EditorStore(await load()); s.apply('seed', seedCells(s.docs, { noise: 0.1, seed: 7 })); assert.deepEqual(s.errors, []); assert.ok(Object.keys(s.docs.polity.cells).length > 50)
  s.apply('water', derivedWaterSource(s.docs)); const rivers = new Set(s.docs.world.edges.filter(e => e.type === 'river').flatMap(e => [e.a, e.b]))
  for (const id of rivers) assert.equal(s.docs.world.provinces[id].waterSource, 'river_adjacent'); assert.equal(s.docs.world.provinces['p:2,3'].waterSource, 'coastal')
  s.apply('pop edit', C.setProvinceField(s.docs, 'p:3,3', 'population', 100)); s.apply('fix', normalisePresence(s.docs)); assert.ok(Math.abs(Object.values(s.docs.nations.presence['p:3,3']).reduce((a, b) => a + b, 0) - 100) <= 2)
})
test('editor -> game round trip: a blank scenario from the template is valid, can be edited, saved, bundled, loaded and played headless', async () => {
  const ruleset = await readJson('data/ruleset.json'), s = new EditorStore(newPackage(ruleset, { id: 'blank', w: 10, h: 6 }))
  s.apply('seed', seedCells(s.docs)); s.apply('river', C.setEdge(s.docs, 'p:4,2', 'p:5,2', 'river')); s.apply('tune', C.setTuning(s.docs, 'prod.alpha', 0.9)); assert.deepEqual(s.errors, [])
  await savePackage('blank', s.snapshot()); assert.ok((await listPackages()).includes('blank'))
  const text = exportBundle(await loadPackage('blank')), docs = importBundle(text); assert.equal(docs.ruleset.tuning['prod.alpha'].value, 0.9)
  const { ruleset: rs, ...pkg } = docs, c = new EngineClient(); await c.init(pkg, rs); await c.runTurns(5)
  const h = await c.query('history'); assert.equal(h.length, 5); assert.ok(h[4].countries.alpha.population > 0)
})
