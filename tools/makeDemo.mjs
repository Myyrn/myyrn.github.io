// tools/makeDemo.mjs — generates scenarios/demo/*.json : 14x10 grid, west sea, a lake, 2 Countries, 3 Nations, 2 Estates.
import { writeFileSync } from 'node:fs'
import { hexId, provId, neighbors, edgeKey } from '../src/modules/worldmap/hex.js'
import { deriveRegions } from '../src/modules/worldmap/regions.js'
const W = 14, H = 10, out = f => new URL(`../scenarios/demo/${f}`, import.meta.url)
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = (h ^ (h >> 13)) * 1274126177 >>> 0; return (h ^ (h >> 16)) / 4294967296 }
const hexes = {}, provinces = {}
const terrainAt = (x, y) => { if (y <= 0) return 'Taiga'; if ((x === 6 || x === 7) && y <= 3) return 'Mountain'; if (x >= 10 && y >= 6) return hash(x, y) < 0.5 ? 'Steppe' : 'Hill'
  if ((x === 6 || x === 7) && y >= 4 && y <= 6) return 'Wetland'; if (x >= 11) return 'Steppe'; return hash(x, y) < 0.2 ? 'Hill' : 'Grassland' }
const FOREST = { Taiga: 70, Mountain: 20, Hill: 30, Steppe: 10, Wetland: 40, Grassland: 25 }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const sea = x < 2, lake = (x === 7 && (y === 4 || y === 5)); hexes[hexId(x, y)] = { x, y, surface: sea ? 'sea' : lake ? 'lake' : 'land' }
  if (sea || lake) continue
  const t = terrainAt(x, y), coastal = x === 2, near = (dx, dy) => hexes[hexId(x + dx, y + dy)]?.surface === 'lake'
  provinces[provId(x, y)] = { x, y, terrain: t, forestation: FOREST[t], habitability: t === 'Mountain' ? 'Claimed/Frontier' : 'Settled',
    waterSource: [[1,0],[-1,0],[0,1],[0,-1]].some(([dx, dy]) => near(dx, dy)) ? 'river_adjacent' : coastal ? 'coastal' : 'none',
    maxArea: 100, maxArableArea: 60, maxPopulationDensity: 6, population: t === 'Mountain' ? 40 : t === 'Taiga' ? 120 : 400, urbanization: 0.1, sanitation: 0.5,
    infrastructureLevel: 30, tradeInfrastructureLevel: 40, owner: x <= 7 ? 'vantiria' : 'kerinia', provenance: 'generated' }
}
// lake hexes are not adjacent-checked above for diagonals; fine for demo. Edges: a river down column 9 and passes through the mountain pair.
const edges = []
for (let y = 1; y < H - 1; y++) if (provinces[provId(9, y)] && provinces[provId(9, y + 1)]) edges.push({ a: provId(9, y), b: provId(9, y + 1), type: 'river', fortress: false, bridge: false })
edges.push({ a: provId(6, 1), b: provId(7, 1), type: 'mountain_pass', fortress: false, bridge: false })
const warehouses = Object.fromEntries(Object.keys(provinces).map(p => [p, { capacity: null, stock: { 'Cold Weapons': 60, Bread: 200 } }]))
const world = { grid: { w: W, h: H, orientation: 'pointy-top-odd-r' }, hexes, provinces, edges, warehouses }
// presence
const presence = {}
for (const [p, pr] of Object.entries(provinces)) { const own = pr.owner === 'vantiria' ? 'vantir' : 'kerin', minority = 'dorn'
  presence[p] = { [own]: Math.round(pr.population * 0.8), [minority]: Math.round(pr.population * 0.2) } }
const nationsDef = { vantir: { name: 'Vantirians', color: '#c0392b', reactionTemperament: 0.6, poolAffinity: { Agriculture: 1.1 }, prefTraits: {} },
  kerin: { name: 'Kerin', color: '#2980b9', reactionTemperament: 0.5, poolAffinity: { Cavalry: 1.3 }, prefTraits: {} },
  dorn: { name: 'Dornish', color: '#27ae60', reactionTemperament: 0.8, poolAffinity: { Mining: 1.2 }, prefTraits: {} } }
const nations = { nations: nationsDef, presence }
const countries = { countries: { vantiria: { name: 'Empire of Vantiria', color: '#c0392b', titularNations: ['vantir'], isPlayer: true, aiProfile: null },
  kerinia: { name: 'Kerinian Khanate', color: '#2980b9', titularNations: ['kerin'], isPlayer: false, aiProfile: 'default' } } }
// regions from the engine's own function (ids match the loader)
const owners = Object.fromEntries(Object.entries(provinces).map(([p, pr]) => [p, pr.owner]))
const regs = deriveRegions({ w: W, h: H }, owners)
const estates = { peasants: { label: 'Peasantry', populationShare: 0.92, wealthPerCap: 0.5, prefBaseline: { extraction_investment: 0.3, conservatism_reformism: -0.2 },
    labourShare: { Agriculture: 0.4, Mining: 0.04, Woodcraft: 0.04, Fishing: 0.01, 'Crafting/Industry': 0.2, 'Trade/Commerce': 0.02, Medicine: 0.01, Builders: 0.01, Teaching: 0.005, Culture: 0.005, 'Shock Infantry': 0.02, 'Pike Infantry': 0.01, Skirmishers: 0.01 } },
  nobility: { label: 'Nobility', populationShare: 0.08, wealthPerCap: 6, prefBaseline: { extraction_investment: -0.5, conservatism_reformism: -0.6 }, labourShare: { Bureaucrats: 0.25, Cavalry: 0.15, Diplomacy: 0.05, Culture: 0.05, Teaching: 0.05 } } }
const cells = {}
for (const [rid, reg] of Object.entries(regs.regions)) for (const n of ['vantir', 'kerin', 'dorn']) {
  const pop = reg.provinces.reduce((s, p) => s + (presence[p][n] ?? 0), 0); if (pop < 1) continue
  for (const [eid, e] of Object.entries(estates)) { const P = Math.round(pop * e.populationShare); if (P < 1) continue
    cells[`${n}|${eid}|${rid}`] = { population: P, wealth: Math.round(P * e.wealthPerCap), labour: Object.fromEntries(Object.entries(e.labourShare).map(([k, v]) => [k, Math.round(P * v)])) } } }
const polity = { estates: Object.fromEntries(Object.entries(estates).map(([k, v]) => [k, { label: v.label, populationShare: v.populationShare, prefBaseline: v.prefBaseline, wealthPerCap: v.wealthPerCap, labourShare: v.labourShare }])),
  lawTemplates: { default: { rights: { Council: [{ scope: { kind: 'estate', estate: 'nobility' }, value: true, declaredTurn: 0 }], 'Veto.taxLaw': [{ scope: { kind: 'estate', estate: 'nobility' }, value: true, declaredTurn: 0 }], 'Veto.market': [{ scope: { kind: 'estate', estate: 'nobility' }, value: true, declaredTurn: 0 }] },
                             duties: { Taxation: [{ scope: { kind: 'empire' }, value: { market: 0.05, wealth: 0 }, declaredTurn: 0 }] }, requisitions: [] } },
  countryLaws: { vantiria: { template: 'default' }, kerinia: { template: 'default' } }, cells,
  governments: { vantiria: { ledger: 500, commitBureaucrats: 1 }, kerinia: { ledger: 500, commitBureaucrats: 1 } } }
const relations = { claims: [], treaties: [], confederations: [] }
const scenario = { startTurn: 0, playerCountry: 'vantiria', options: { fogOfWar: false } }
const manifest = { schemaVersion: 1, id: 'demo', name: 'Demo — 2 Countries', description: 'Small launchable demo (14x10 grid)', seed: 20261104 }
for (const [f, d] of Object.entries({ 'manifest.json': manifest, 'world.json': world, 'nations.json': nations, 'countries.json': countries, 'polity.json': polity, 'relations.json': relations, 'scenario.json': scenario }))
  writeFileSync(out(f), JSON.stringify(d, null, 1))
console.log('provinces', Object.keys(provinces).length, 'regions', Object.keys(regs.regions).length, 'cells', Object.keys(cells).length)
