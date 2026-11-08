// kernel/scope.js — shared scope syntax (Rights/Duties, Requisition, Control, Observation, UI Scope).
import { parseCellKey } from './ids.js'

/** @typedef {{kind:'cell',nation:string,estate:string,region:string}
 *  | {kind:'nationRegion',nation:string,region:string} | {kind:'estateRegion',estate:string,region:string}
 *  | {kind:'estate',estate:string} | {kind:'nation',nation:string} | {kind:'region',region:string}
 *  | {kind:'empire'}} Scope */
/** @typedef {{kind:'group',cells:string[]}} GroupTarget  (allocation-local, not part of the shared syntax) */

/** ctx must provide: country (Id), cellKeys():CellKey[] (cells of ctx.country), cellCountry(CellKey):Id */
// A converged cell carries a combined Estate label 'a+b' (Internal Politics, Convergence); scopes naming either part cover it.
export const estateParts = e => e.split('+')
export const mergedEstateLabel = (a, b) => [...new Set([...estateParts(a), ...estateParts(b)])].sort().join('+')
export function covers(scope, key, ctx) {
  const c = parseCellKey(key)
  switch (scope.kind) {
    case 'cell': return c.nation === scope.nation && estateParts(c.estate).includes(scope.estate) && c.region === scope.region
    case 'nationRegion': return c.nation === scope.nation && c.region === scope.region
    case 'estateRegion': return estateParts(c.estate).includes(scope.estate) && c.region === scope.region
    case 'estate': return estateParts(c.estate).includes(scope.estate)
    case 'nation': return c.nation === scope.nation
    case 'region': return c.region === scope.region
    case 'empire': return ctx.cellCountry(key) === ctx.country
    case 'group': return scope.cells.includes(key)
    default: throw new Error(`unknown scope kind ${scope.kind}`)
  }
}

export function cellsCovered(scope, ctx) {
  if (scope.kind === 'group') return scope.cells.filter(k => ctx.cellKeys().includes(k))
  return ctx.cellKeys().filter(k => covers(scope, k, ctx))
}

// Region is broader (less specific) than Estate/Nation (designer ruling 2026-11-04).
export const SPECIFICITY = { cell: 4, nationRegion: 3, estateRegion: 3, estate: 2, nation: 2, region: 1, empire: 0 }
export const specificity = scope => SPECIFICITY[scope.kind]

/** Rights/Duties are STATES: most specific scope wins; ties (Estate vs Nation) -> latest declaredTurn wins.
 *  Returns undefined when silent (= "allowed (default)"). entries: {scope, value, declaredTurn, seq?} */
export function resolveState(entries, key, ctx) {
  const hits = entries.filter(e => covers(e.scope, key, ctx))
  if (!hits.length) return undefined
  const top = Math.max(...hits.map(h => specificity(h.scope)))
  const best = hits.filter(h => specificity(h.scope) === top)
  best.sort((a, b) => (b.declaredTurn - a.declaredTurn) || ((b.seq ?? 0) - (a.seq ?? 0)))
  return best[0].value
}

/** Control / Requisition are AMOUNTS: stack additively over every covering entry. */
export const resolveAmount = (entries, key, ctx) =>
  entries.filter(e => covers(e.scope, key, ctx)).reduce((s, e) => s + e.amount, 0)
