// polity/convergence.js — Estate Convergence: structural, top-down, per (Nation, Region) cell pair (internal_politics__kb Rule 31).
// Trigger: Rights AND Duties checklist distance -> 0. Rarity is never flagged: closing the distance takes many gated, entitlement-loss-generating
// reforms. Activation: ruler-declared (Control-gated action) OR estate-forced (defiance action at the top rung). Both routes schedule the SAME merge at
// step 8 (before the Region pass) — Outcome Asymmetry: they differ only through gating/Weight/Control/Pressure, never a bespoke penalty.
import { mergeCells as mergeRegionCells } from '../worldmap/regions.js'
import { mergedEstateLabel, estateParts } from '../../kernel/scope.js'
import { cellKey, parseCellKey } from '../../kernel/ids.js'
import { cellsOf, cellsOfNationRegion, RECORDS, EXTENSIVE } from './cellstate.js'

const diffValue = (a, b) => {                                                       // per-entry distance in [0,1]
  if (a === undefined && b === undefined) return 0
  if (typeof a === 'number' && typeof b === 'number') return Math.min(1, Math.abs(a - b))
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) { const ks = new Set([...Object.keys(a), ...Object.keys(b)]); let d = 0; for (const k of ks) d += diffValue(a[k], b[k]); return Math.min(1, d / (ks.size || 1)) }
  return JSON.stringify(a) === JSON.stringify(b) ? 0 : 1 }
/** Distance between two same-Country cells: sum over every Right and Duty id of the per-entry distance (silent value where no law speaks). */
export function checklistDistance(ctx, keyA, keyB) {
  let d = 0
  for (const id of Object.keys(ctx.ruleset.rights ?? {})) d += diffValue(ctx.derive.polity.right(keyA, id), ctx.derive.polity.right(keyB, id))
  for (const id of Object.keys(ctx.ruleset.duties ?? {})) d += diffValue(ctx.derive.polity.duty(keyA, id), ctx.derive.polity.duty(keyB, id))
  return d }
/** Derived candidate pairs (never stored): same Nation + Region, distinct cells, distance <= eps. */
export function convergenceCandidates(ctx) {
  const seen = new Set(), out = []
  for (const key of Object.keys(cellsOf(ctx)).sort()) { const c = cellsOf(ctx)[key], g = `${c.nation}|${c.region}`; if (seen.has(g)) continue; seen.add(g)
    const cells = cellsOfNationRegion(ctx, c.nation, c.region).sort((x, y) => (x.key < y.key ? -1 : 1))
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) if (checklistDistance(ctx, cells[i].key, cells[j].key) <= ctx.T('conv.eps')) out.push([cells[i].key, cells[j].key]) }
  return out }

const scaled = (mods, f) => (mods ?? []).map(m => ({ ...m, value: m.value * f }))
const blend = (x, wa, y, wb) => ((x ?? 0) * wa + (y ?? 0) * wb) / (wa + wb || 1)
/** Merge two cells of one (Nation, Region): extensive stocks sum (population-sum constraint holds), intensive state blends by population; combined Estate label. */
export function mergeConverged(ctx, keyA, keyB) {
  const P = ctx.state.polity, a = P.cells[keyA], b = P.cells[keyB]; if (!a || !b || a.nation !== b.nation || a.region !== b.region) return null
  const wa = a.population, wb = b.population, fa = wa / (wa + wb || 1), fb = 1 - fa, estate = mergedEstateLabel(a.estate, b.estate), key = cellKey(a.nation, estate, a.region)
  const m = mergeRegionCells([a, b], a.region); m.key = key; m.estate = estate
  m.laborProfile = {}; for (const p of new Set([...Object.keys(a.laborProfile ?? {}), ...Object.keys(b.laborProfile ?? {})])) m.laborProfile[p] = blend(a.laborProfile?.[p], wa, b.laborProfile?.[p], wb)
  m.pref = {}; m.prefMods = {}
  for (const ax of new Set([...Object.keys(a.pref ?? {}), ...Object.keys(b.pref ?? {}), ...Object.keys(a.prefMods ?? {}), ...Object.keys(b.prefMods ?? {})])) {
    m.pref[ax] = blend(a.pref?.[ax], wa, b.pref?.[ax], wb); m.prefMods[ax] = [...scaled(a.prefMods?.[ax], fa), ...scaled(b.prefMods?.[ax], fb)] }
  for (const k of ['opinionGovMods', 'prestigeMods', 'fairnessMods']) m[k] = [...scaled(a[k], fa), ...scaled(b[k], fb)]    // a population-weighted mean of two stacks
  const partsOf = (c, f) => (c.flags?.parts ?? [{ estate: c.estate, share: 1 }]).map(p => ({ ...p, share: p.share * f }))
  m.flags = { ...(a.flags ?? {}), converged: true, parts: [...partsOf(a, fa), ...partsOf(b, fb)] }
  m.defiance = {}; m.hoardFrac = Math.max(a.hoardFrac ?? 0, b.hoardFrac ?? 0)
  for (const cache of [P.momentum, P.rung]) { const needs = new Set(Object.keys(cache).filter(k => k.startsWith(keyA + '|') || k.startsWith(keyB + '|')).map(k => k.split('|')[3]))   // cached state follows the Region-merge rule's spirit: population-weighted
    for (const n of needs) { cache[`${key}|${n}`] = blend(cache[`${keyA}|${n}`], wa, cache[`${keyB}|${n}`], wb); delete cache[`${keyA}|${n}`]; delete cache[`${keyB}|${n}`] } }
  for (const o of ctx.state.economy.obligations) { if (o.debtor === keyA || o.debtor === keyB) o.debtor = key; if (o.creditor === keyA || o.creditor === keyB) o.creditor = key }
  ctx.state.economy.obligations = ctx.state.economy.obligations.filter(o => o.debtor !== o.creditor)
  delete P.cells[keyA]; delete P.cells[keyB]; P.cells[key] = m; ctx.bump(); return key }

/** Reversal via later reform/drift: when the part Estates' laws differ again, a converged cell splits by its stored part shares (pro-rata stocks). */
export function divergeCell(ctx, key) {
  const P = ctx.state.polity.cells, c = P[key]; if (!c?.flags?.converged || !c.flags.parts?.length) return null
  const probe = e => cellKey(c.nation, e, c.region), parts = c.flags.parts, base = probe(parts[0].estate)
  const apart = parts.slice(1).some(p => checklistDistance(ctx, base, probe(p.estate)) > ctx.T('conv.eps')); if (!apart) return null
  delete P[key]; const keys = []
  for (const p of parts) { const nk = probe(p.estate), n = structuredClone(c); n.key = nk; n.estate = p.estate
    for (const k of EXTENSIVE) n[k] = c[k] * p.share
    for (const rec of RECORDS) for (const r of Object.keys(c[rec] ?? {})) n[rec][r] = c[rec][r] * p.share
    n.flags = { ...c.flags, converged: false, parts: undefined }; P[nk] = n; keys.push(nk) }
  ctx.bump(); return keys }

const inScope = (ctx, key, scope) => { if (!scope) return true; const k = cellsOf(ctx)[key]; return (!scope.nation || k.nation === scope.nation) && (!scope.region || k.region === scope.region) }
/** Scheduled handler (step 8): merge the (still valid) candidate pairs inside the declared scope, one pair per (Nation, Region) per act. */
export function runConvergence(ctx, payload) {
  const done = new Set(), merged = []
  for (const [x, y] of convergenceCandidates(ctx)) {
    if (!cellsOf(ctx)[x] || !cellsOf(ctx)[y]) continue                                                   // an earlier merge in this pass consumed one of them
    const g = `${cellsOf(ctx)[x].nation}|${cellsOf(ctx)[x].region}`; if (done.has(g)) continue
    if (payload.cell ? ![x, y].includes(payload.cell) : !inScope(ctx, x, payload.scope)) continue
    const k = mergeConverged(ctx, x, y); if (k) { done.add(g); merged.push(k) } }
  return merged }
