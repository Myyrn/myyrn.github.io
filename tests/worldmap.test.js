import test from 'node:test'
import assert from 'node:assert/strict'
import { neighbors, distance, hexId, parseId, edgePassable, edgeKey } from '../src/modules/worldmap/hex.js'
import { deriveRegions, splitShares, splitCell, mergeCells } from '../src/modules/worldmap/regions.js'

test('odd-r neighbours are symmetric and distance matches', () => {
  const W = 25, H = 20
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    for (const n of neighbors(x, y, W, H)) {
      assert.ok(neighbors(n.x, n.y, W, H).some(m => m.x === x && m.y === y), `asym ${x},${y}->${n.x},${n.y}`)
      assert.equal(distance({ x, y }, n), 1)
    }
  assert.equal(neighbors(0, 0, W, H).length, 2)           // corner (even row) has E and SE only
  assert.equal(neighbors(5, 5, W, H).length, 6)
})
test('mountain interior edges blocked unless pass; mountain<->other open', () => {
  const edges = { [edgeKey('p:1,1', 'p:2,1')]: { type: 'mountain_pass' } }
  const terr = p => ({ 'p:1,1': 'Mountain', 'p:2,1': 'Mountain', 'p:3,1': 'Mountain', 'p:0,1': 'Grassland' })[p]
  assert.equal(edgePassable('p:1,1', 'p:2,1', edges, terr), true)
  assert.equal(edgePassable('p:2,1', 'p:3,1', edges, terr), false)
  assert.equal(edgePassable('p:0,1', 'p:1,1', edges, terr), true)
})
function block(x0, y0, w, h, owner, owners) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) owners[`p:${x},${y}`] = owner }
test('regions: contiguous, same owner, 6-8 hexes, deterministic, stable under unrelated change', () => {
  const world = { w: 25, h: 20 }, owners = {}
  block(0, 0, 6, 5, 'A', owners)      // 30 provinces
  block(10, 0, 3, 3, 'B', owners)     // 9 provinces
  const r1 = deriveRegions(world, owners), r2 = deriveRegions(world, owners)
  assert.deepEqual(r1, r2)
  for (const r of Object.values(r1.regions)) {
    if (r.owner === 'A') assert.ok(r.provinces.length >= 6 && r.provinces.length <= 8, `A region size ${r.provinces.length}`)
    else assert.equal(r.provinces.length, 9)                      // components < 12 are not split
  }
  assert.equal(Object.values(r1.regions).filter(r => r.owner === 'A').reduce((s, r) => s + r.provinces.length, 0), 30)
  // change ownership of a far province of B: A regions keep ids
  const owners2 = { ...owners, 'p:12,2': 'A' }
  const r3 = deriveRegions(world, owners2, r1)
  const idsA = Object.entries(r1.assignment).filter(([p]) => owners[p] === 'A' && p !== 'p:12,2').every(([p, rid]) => r3.assignment[p] === rid)
  assert.ok(idsA, 'unchanged Regions keep their ids (snapshot-and-drift)')
})
test('fracture split by Nations presence preserves extensive totals; merge sums', () => {
  const cell = { nation: 'v', estate: 'peas', region: 'r1', population: 1000, wealth: 90, labour: { Agriculture: 600 }, grievance: { subsistence: 0.4 } }
  const presence = p => ({ 'p:0,0': 300, 'p:1,0': 100, 'p:2,0': 600 })[p]
  const shares = splitShares(['p:0,0', 'p:1,0', 'p:2,0'], { rA: ['p:0,0', 'p:1,0'], rB: ['p:2,0'] }, presence)
  assert.deepEqual(shares, { rA: 0.4, rB: 0.6 })
  const parts = splitCell(cell, shares)
  assert.equal(parts.rA.population + parts.rB.population, 1000)
  assert.ok(Math.abs(parts.rA.wealth + parts.rB.wealth - 90) < 1e-9)
  assert.equal(parts.rA.grievance.subsistence, 0.4)               // intensive copied
  const m = mergeCells([parts.rA, parts.rB], 'r9')
  assert.equal(m.population, 1000); assert.ok(Math.abs(m.labour.Agriculture - 600) < 1e-9); assert.ok(Math.abs(m.grievance.subsistence - 0.4) < 1e-9)
})
