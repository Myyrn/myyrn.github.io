// worldmap/regions.js — Region = 6-8 contiguous same-owner land provinces; snapshot-and-drift; one end-of-turn pass.
import { parseId, neighbors } from './hex.js'

/** world: {w,h}; owners: Record<provId, countryId|null>  (land provinces only; unowned provinces get no Region)
 *  prev: {assignment: Record<provId,regionId>, next: number} | null  ->  {assignment, regions, next} */
export function deriveRegions(world, owners, prev = null, {target = 7, minSize = 6, maxSize = 8} = {}) {
  const provs = Object.keys(owners).filter(p => owners[p])
  const adj = p => { const { x, y } = parseId(p); return neighbors(x, y, world.w, world.h).map(n => `p:${n.x},${n.y}`).filter(q => owners[q] === owners[p]) }
  const assignment = {}; let next = prev?.next ?? 1
  const regionsOld = {}
  for (const [p, r] of Object.entries(prev?.assignment ?? {})) (regionsOld[r] ??= []).push(p)
  const kept = new Set()
  for (const [rid, ps] of Object.entries(regionsOld).sort()) {           // 1. keep Regions that are still whole, same-owner and contiguous
    if (ps.every(p => owners[p] && owners[p] === owners[ps[0]]) && connected(ps, adj)) { ps.forEach(p => assignment[p] = rid); kept.add(rid) }
  }
  const free = new Set(provs.filter(p => !(p in assignment)))
  for (const comp of components([...free].sort(), q => adj(q).filter(z => free.has(z)))) {
    const owner = owners[comp[0]]
    // 2. small leftovers join an adjacent kept Region of the same owner if it stays <= maxSize
    if (comp.length < minSize) {
      const hostId = [...new Set(comp.flatMap(p => adj(p)).map(q => assignment[q]).filter(Boolean))].sort()
        .find(rid => sizeOf(assignment, rid) + comp.length <= maxSize)
      if (hostId) { comp.forEach(p => assignment[p] = hostId); continue }
    }
    const n = comp.length
    const k = n < 2 * minSize ? 1 : Math.min(Math.floor(n / minSize), Math.max(Math.ceil(n / maxSize), Math.round(n / target)))   // components too small to split stay whole (may exceed maxSize)
    for (const part of cluster(comp, k, q => adj(q).filter(z => free.has(z)), minSize, maxSize)) { const id = `r${next++}`; part.forEach(p => assignment[p] = id) }
  }
  const regions = {}
  for (const [p, r] of Object.entries(assignment)) (regions[r] ??= { owner: owners[p], provinces: [] }).provinces.push(p)
  for (const r of Object.values(regions)) r.provinces.sort()
  return { assignment, regions, next }
}
const sizeOf = (assignment, rid) => Object.values(assignment).filter(r => r === rid).length
function connected(ps, adj) { const set = new Set(ps); return components(ps, q => adj(q).filter(z => set.has(z))).length === 1 }
function components(nodes, nbrs) {
  const seen = new Set(), out = []
  for (const n of nodes) { if (seen.has(n)) continue; const comp = [], st = [n]; seen.add(n)
    while (st.length) { const c = st.pop(); comp.push(c); for (const m of nbrs(c)) if (!seen.has(m)) { seen.add(m); st.push(m) } }
    out.push(comp.sort()) }
  return out
}
function bfsDist(src, nodes, nbrs) { const d = new Map([[src, 0]]), q = [src]
  while (q.length) { const c = q.shift(); for (const m of nbrs(c)) if (nodes.has(m) && !d.has(m)) { d.set(m, d.get(c) + 1); q.push(m) } } return d }
/** farthest-point seeds then balanced round-robin flood fill (deterministic) */
function cluster(comp, k, nbrs, minSize, maxSize) {
  if (k === 1) return [comp]
  const set = new Set(comp), seeds = [comp[0]]
  while (seeds.length < k) { const ds = seeds.map(s => bfsDist(s, set, nbrs))
    seeds.push(comp.filter(p => !seeds.includes(p)).sort((a, b) => Math.min(...ds.map(d => d.get(b))) - Math.min(...ds.map(d => d.get(a))) || (a < b ? -1 : 1))[0]) }
  const part = new Map(seeds.map((s, i) => [s, i])), fronts = seeds.map(s => [s])
  while (part.size < comp.length) { let moved = false
    for (let i = 0; i < k; i++) { const f = fronts[i], cand = []
      for (const c of f) for (const m of nbrs(c)) if (set.has(m) && !part.has(m)) cand.push(m)
      const pick = [...new Set(cand)].sort()[0]; if (pick) { part.set(pick, i); f.push(pick); moved = true } }
    if (!moved) break }
  rebalance(part, comp, k, nbrs, minSize, maxSize)
  return seeds.map((_, i) => comp.filter(p => part.get(p) === i))
}
/** move boundary provinces from oversize (or any big) parts to undersize neighbours while the donor stays contiguous */
function rebalance(part, comp, k, nbrs, minSize, maxSize) {
  const sizes = () => Array.from({length: k}, (_, i) => comp.filter(p => part.get(p) === i).length)
  const ok = (i, without) => { const ps = comp.filter(p => part.get(p) === i && p !== without), set = new Set(ps); return components(ps, q => nbrs(q).filter(z => set.has(z))).length === 1 }
  for (let guard = 0; guard < 200; guard++) {
    const sz = sizes(); const bad = sz.findIndex(x => x < minSize || x > maxSize); if (bad < 0) return
    let moved = false
    if (sz[bad] < minSize) {                                  // pull from a neighbouring part that can spare one
      for (const p of comp.filter(p => part.get(p) !== bad).sort())
        if (nbrs(p).some(q => part.get(q) === bad) && sz[part.get(p)] > minSize && ok(part.get(p), p)) { part.set(p, bad); moved = true; break }
    } else {                                                  // push to a neighbouring part that has room
      for (const p of comp.filter(p => part.get(p) === bad).sort())
        if (ok(bad, p)) { const to = nbrs(p).map(q => part.get(q)).find(i => i !== bad && sz[i] < maxSize); if (to !== undefined) { part.set(p, to); moved = true; break } }
    }
    if (!moved) return
  }
}

/** --- cell stock re-keying on fracture / merger (per-cell state split by Nations' population share) --- */
export const RECORDS = ['labour', 'labourCommitted', 'hoard']          // extensive records (split pro rata, summed on merge)
export const EXTENSIVE = ['population', 'wealth']                 // split pro rata / summed
/** shares: Record<newRegionId, fraction> (Σ = 1) from Nations' presence in the provinces of each part */
export function splitShares(oldProvs, parts, presenceOf /* (prov)=>count of this nation */) {
  const tot = oldProvs.reduce((s, p) => s + presenceOf(p), 0), out = {}
  for (const [rid, ps] of Object.entries(parts)) out[rid] = tot === 0 ? 1 / Object.keys(parts).length : ps.reduce((s, p) => s + presenceOf(p), 0) / tot
  return out
}
export function splitCell(cell, shares) {
  const out = {}
  for (const [rid, f] of Object.entries(shares)) {
    const c = structuredClone(cell); c.region = rid
    for (const k of EXTENSIVE) if (k in c) c[k] = cell[k] * f
    for (const rec of RECORDS) if (c[rec]) for (const k of Object.keys(c[rec])) c[rec][k] = cell[rec][k] * f
    out[rid] = c       // intensive fields (grievance, opinion, preference stacks, momentum) are copied unchanged
  }
  return out
}
export function mergeCells(cells, newRegion) {
  const tot = cells.reduce((s, c) => s + c.population, 0) || 1, m = structuredClone(cells[0]); m.region = newRegion
  for (const k of EXTENSIVE) m[k] = cells.reduce((s, c) => s + (c[k] ?? 0), 0)
  for (const rec of RECORDS) { m[rec] = {}; for (const c of cells) for (const [k, v] of Object.entries(c[rec] ?? {})) m[rec][k] = (m[rec][k] ?? 0) + v }
  m.grievance = {}; for (const c of cells) for (const [n, v] of Object.entries(c.grievance ?? {})) m.grievance[n] = (m.grievance[n] ?? 0) + v * c.population / tot
  return m
}
