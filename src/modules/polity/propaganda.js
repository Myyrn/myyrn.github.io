// polity/propaganda.js — Cell Preferences & Propaganda (internal_politics__kb). Propaganda directs LABOUR of the Culture / Teaching pools away
// from ordinary use (zero-sum); the Government instead draws on Administration's Coordination. FAST channel: writes the decaying modifier stack `prefMods`.
// Education (directed Teaching) is SLOW: moves the preference BASELINE. Persuasion is separate (moves Opinion, never preference).
import { scopeCtx } from '../administration/module.js'
import { covers } from '../../kernel/scope.js'
import { effectivePref, prefMods, clamp, cellsOf, countryOfKey } from './cellstate.js'
export const PROPAGANDA_POOLS = ['Culture', 'Teaching']                                  // Printed Goods are a GOOD (stock-directed), not a labour pool: that channel is deferred
const ofType = (ctx, ...types) => ctx.state.commitments.filter(c => types.includes(c.type))
export const directedShare = (ctx, holderKey, pool) => ofType(ctx, 'propaganda').filter(c => c.actor.kind === 'cell' && c.actor.key === holderKey && c.params.pool === pool).reduce((a, c) => a + c.params.amount, 0)
export const propagandaDraw = (ctx, country) => ofType(ctx, 'propaganda').filter(c => c.actor.kind === 'government' && c.actor.country === country).reduce((a, c) => a + c.params.amount, 0)
export const freePoolLabour = (ctx, key, pool) => { const c = cellsOf(ctx)[key]; return Math.max(0, (c.labour[pool] ?? 0) - (c.labourCommitted?.[pool] ?? 0) - directedShare(ctx, key, pool)) }

/** Government amalgam (derived, never stored): Weight-weighted mean of the cells' effective preferences. Value source of an AI Government; for a player Government only a readout. */
export function amalgam(ctx, country) {
  const keys = Object.keys(cellsOf(ctx)).filter(k => countryOfKey(ctx, k) === country), axes = new Set(keys.flatMap(k => Object.keys(cellsOf(ctx)[k].pref ?? {}))), tw = keys.reduce((s, k) => s + ctx.derive.polity.weight(k), 0) || 1
  return Object.fromEntries([...axes].map(ax => [ax, keys.reduce((s, k) => s + ctx.derive.polity.weight(k) * effectivePref(cellsOf(ctx)[k], ax), 0) / tw])) }

/** Push one cell's preference toward `ideal` (fast channel): never overshoots, summed modifier within +-pref.modRange (able to cross the baseline sign: reversible).
 *  Cost is proportional to distance moved because the push per unit of directed output is fixed. Returns total |change|. Reused by Diplomacy's foreignPropaganda. */
export function pushPreference(ctx, cell, ideal, amount, { source } = {}) {
  const T = ctx.T, range = T('pref.modRange'); let moved = 0
  for (const [axis, target] of Object.entries(ideal)) {
    const eff = effectivePref(cell, axis), gap = target - eff; if (Math.abs(gap) < T('eps.modifier')) continue
    const push = Math.sign(gap) * Math.min(Math.abs(gap), T('prop.rate') * T('prop.resist') * amount / Math.max(1, cell.population))
    const mods = prefMods(cell, axis), sum = mods.reduce((a, m) => a + m.value, 0), applied = clamp(sum + push, -range, range) - sum; if (Math.abs(applied) < 1e-12) continue
    mods.push({ id: `prop.${ctx.state.meta.turn}.${source ?? 'x'}`, value: applied, decay: { kind: 'exp', rateKey: 'pref.modDecay' }, turn: ctx.state.meta.turn, source }); moved += Math.abs(applied) }
  return moved }
/** SLOW, durable channel: education moves the BASELINE toward the producer's ideal. */
export function educatePreference(ctx, cell, ideal, teachingDirected) {
  const f = Math.min(1, ctx.T('edu.rate') * teachingDirected / Math.max(1, cell.population)); cell.pref ??= {}
  for (const [axis, target] of Object.entries(ideal)) cell.pref[axis] = clamp((cell.pref[axis] ?? 0) + f * (target - (cell.pref[axis] ?? 0)), -1, 1) }

function targets(ctx, c) {
  const country = c.actor.kind === 'government' ? c.actor.country : countryOfKey(ctx, c.actor.key), sc = scopeCtx(ctx, country)
  return sc.cellKeys().filter(k => covers(c.params.targets ?? { kind: 'empire' }, k, sc)).map(k => cellsOf(ctx)[k]) }
/** Standing commitments run every turn, at the START of polity step 5 (so opinion alignment sees the new preference). Commitments of vanished cells lapse. */
export function stepPropaganda(ctx) {
  const out = []
  ctx.state.commitments = ctx.state.commitments.filter(c => !['propaganda'].includes(c.type) || c.actor.kind !== 'cell' || cellsOf(ctx)[c.actor.key])
  for (const c of ofType(ctx, 'propaganda')) {
    const cells = targets(ctx, c); if (!cells.length) continue
    const ideal = c.params.ideal ?? amalgam(ctx, c.actor.kind === 'government' ? c.actor.country : countryOfKey(ctx, c.actor.key)), per = c.params.amount / cells.length
    for (const cell of cells) c.params.pool === 'Teaching' ? educatePreference(ctx, cell, ideal, per) : pushPreference(ctx, cell, ideal, per, { source: c.id })
    out.push({ id: c.id, cells: cells.length }) }
  if (out.length) ctx.bump()
  return out }
