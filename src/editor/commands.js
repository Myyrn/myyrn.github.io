// editor/commands.js — high-level edit intents -> patch lists (pure: read docs, return patches). Brush strokes and forms both use these.
import { ptr } from './patch.js'
import { neighbors } from '../modules/worldmap/hex.js'
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
const edgeIndex = (docs, a, b) => docs.world.edges.findIndex(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))

export function paintTerrain(docs, provinceIds, terrain) {                  // terrain changes clamp forestation to the new ceiling; touched provinces become 'manual' (worldgen lock)
  const t = docs.ruleset.terrain[terrain]; if (!t) throw new Error(`unknown terrain ${terrain}`); const out = []
  for (const id of provinceIds) { const p = docs.world.provinces[id]; if (!p) continue
    out.push({ op: 'replace', path: ptr('world', 'provinces', id, 'terrain'), value: terrain }, { op: 'replace', path: ptr('world', 'provinces', id, 'forestation'), value: clamp(p.forestation ?? t.forestMin, t.forestMin, t.forestMax) },
      { op: 'add', path: ptr('world', 'provinces', id, 'provenance'), value: 'manual' }) }
  return out }
export function setProvinceField(docs, id, field, value) { return [{ op: 'replace', path: ptr('world', 'provinces', id, field), value }, { op: 'add', path: ptr('world', 'provinces', id, 'provenance'), value: 'manual' }] }
export function setOwner(docs, provinceIds, countryId) { return provinceIds.filter(id => docs.world.provinces[id]).map(id => ({ op: 'add', path: ptr('world', 'provinces', id, 'owner'), value: countryId })) }
export function setEdge(docs, a, b, type, extra = {}) {                      // type null removes the edge
  const i = edgeIndex(docs, a, b), out = []; if (i >= 0) out.push({ op: 'remove', path: ptr('world', 'edges', i) })
  if (type) out.push({ op: 'add', path: ptr('world', 'edges', '-'), value: { a, b, type, fortress: false, bridge: false, ...extra } }); return out }
export function toggleEdgeFlag(docs, a, b, flag) { const i = edgeIndex(docs, a, b); return i < 0 ? [] : [{ op: 'replace', path: ptr('world', 'edges', i, flag), value: !docs.world.edges[i][flag] }] }
export function setSurface(docs, x, y, surface) {                            // land <-> sea/lake; water hexes lose their province, presence, warehouse and incident edges
  const hid = `h:${x},${y}`, pid = `p:${x},${y}`, out = [{ op: 'replace', path: ptr('world', 'hexes', hid, 'surface'), value: surface }]
  if (surface === 'land' && !docs.world.provinces[pid]) { const t = Object.keys(docs.ruleset.terrain).includes('Grassland') ? 'Grassland' : Object.keys(docs.ruleset.terrain)[0], tr = docs.ruleset.terrain[t]
    out.push({ op: 'add', path: ptr('world', 'provinces', pid), value: { x, y, terrain: t, forestation: tr.forestMin, habitability: 'Claimed/Frontier', waterSource: 'none', maxArea: 100, maxArableArea: 50, maxPopulationDensity: 6, population: 0, urbanization: 0, sanitation: 0.5, infrastructureLevel: 0, tradeInfrastructureLevel: 0, owner: null, provenance: 'manual' } }) }
  if (surface !== 'land' && docs.world.provinces[pid]) { out.push({ op: 'remove', path: ptr('world', 'provinces', pid) })
    if (docs.nations.presence?.[pid]) out.push({ op: 'remove', path: ptr('nations', 'presence', pid) }); if (docs.world.warehouses?.[pid]) out.push({ op: 'remove', path: ptr('world', 'warehouses', pid) })
    docs.world.edges.map((e, i) => [e, i]).filter(([e]) => e.a === pid || e.b === pid).map(([, i]) => i).sort((a, b) => b - a).forEach(i => out.push({ op: 'remove', path: ptr('world', 'edges', i) })) }
  return out }
export const setPresence = (docs, pid, nation, count) => (docs.nations.presence?.[pid] ? [{ op: 'add', path: ptr('nations', 'presence', pid, nation), value: count }] : [{ op: 'add', path: ptr('nations', 'presence', pid), value: { [nation]: count } }])
export const setRulesetValue = (docs, path, value) => [{ op: 'replace', path, value }]
export const setTuning = (docs, key, value, status = 'authored') => [{ op: 'add', path: ptr('ruleset', 'tuning', key), value: { value, status } }]
export const addNation = (docs, id, def) => [{ op: 'add', path: ptr('nations', 'nations', id), value: { name: def.name ?? id, color: def.color ?? '#888888', reactionTemperament: 0.5, poolAffinity: {}, prefTraits: {}, ...def } }]
export const addCountry = (docs, id, def) => [{ op: 'add', path: ptr('countries', 'countries', id), value: { name: def.name ?? id, color: def.color ?? '#888888', titularNations: [], isPlayer: false, aiProfile: null, ...def } },
  { op: 'add', path: ptr('polity', 'countryLaws', id), value: { template: Object.keys(docs.polity.lawTemplates)[0] } }, { op: 'add', path: ptr('polity', 'governments', id), value: { ledger: 0, commitBureaucrats: 1 } }]
export function adjacentProvinces(docs, id) { const p = docs.world.provinces[id]; return neighbors(p.x, p.y, docs.world.grid.w, docs.world.grid.h).map(n => `p:${n.x},${n.y}`).filter(q => docs.world.provinces[q]) }
