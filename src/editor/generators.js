// editor/generators.js — patch-producing, previewable, undoable generators. They return patches only and never mutate the package.
import { ptr } from './patch.js'
import { regionsOf } from '../data/validators/index.js'
import { neighbors } from '../modules/worldmap/hex.js'
const rnd = (seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

/** seedCells: cells = Region × Nation × Estate from presence, Estate templates (population share, wealth per head, labour shares), seeded noise. Sum constraints hold by construction. */
export function seedCells(docs, { noise = 0, seed = 1 } = {}) {
  const r = rnd(seed), regs = regionsOf(docs), cells = {}
  for (const [rid, reg] of Object.entries(regs.regions)) for (const n of Object.keys(docs.nations.nations)) {
    const pop = reg.provinces.reduce((s, p) => s + (docs.nations.presence?.[p]?.[n] ?? 0), 0); if (pop < 1) continue
    for (const [eid, e] of Object.entries(docs.polity.estates)) { const jitter = 1 + noise * (r() - 0.5), P = Math.round(pop * e.populationShare * jitter); if (P < 1) continue
      cells[`${n}|${eid}|${rid}`] = { population: P, wealth: Math.round(P * (e.wealthPerCap ?? 0)), labour: Object.fromEntries(Object.entries(e.labourShare ?? {}).map(([k, v]) => [k, Math.round(P * v)])) } } }
  return [{ op: 'replace', path: ptr('polity', 'cells'), value: cells }] }
/** derivedWaterSource: river edge or lake shore -> river_adjacent (first), sea shore -> coastal, else none. */
export function derivedWaterSource(docs) {
  const w = docs.world, rivers = new Set(); for (const e of w.edges) if (e.type === 'river') { rivers.add(e.a); rivers.add(e.b) }
  return Object.entries(w.provinces).map(([id, p]) => { const nb = neighbors(p.x, p.y, w.grid.w, w.grid.h).map(n => w.hexes[`h:${n.x},${n.y}`]).filter(Boolean)
    const ws = rivers.has(id) || nb.some(h => h.surface === 'lake') ? 'river_adjacent' : nb.some(h => h.surface === 'sea') ? 'coastal' : 'none'
    return p.waterSource === ws ? null : { op: 'replace', path: ptr('world', 'provinces', id, 'waterSource'), value: ws } }).filter(Boolean) }
/** normalisePresence: scale each province's Nation presence to its population (fixes presenceSum warnings after population edits). */
export function normalisePresence(docs) { const out = []
  for (const [pid, pr] of Object.entries(docs.nations.presence ?? {})) { const pop = docs.world.provinces[pid]?.population ?? 0, tot = Object.values(pr).reduce((s, x) => s + x, 0)
    if (tot > 0 && pop > 0 && Math.abs(tot - pop) / pop > 0.001) out.push({ op: 'replace', path: ptr('nations', 'presence', pid), value: Object.fromEntries(Object.entries(pr).map(([n, v]) => [n, Math.round(v * pop / tot)])) }) }
  return out }
export const GENERATORS = { seedCells, derivedWaterSource, normalisePresence }
