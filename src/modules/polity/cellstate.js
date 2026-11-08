// polity/cellstate.js — small shared helpers for the "remaining politics" files (Mobility, Demotion, Convergence, propaganda).
import { parseCellKey } from '../../kernel/ids.js'
import { RECORDS, EXTENSIVE } from '../worldmap/regions.js'
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
export const cellsOf = ctx => ctx.state.polity.cells
export const countryOfKey = (ctx, key) => ctx.derive.worldmap.regionOwner(parseCellKey(key).region)
/** Preference = baseline (number, per Portrait axis) + decaying modifier stack in `prefMods[axis]`, clamped to [-1,+1]. */
export const prefMods = (c, axis) => (c.prefMods ??= {})[axis] ??= []
export const effectivePref = (c, axis) => clamp((c.pref?.[axis] ?? 0) + (c.prefMods?.[axis] ?? []).reduce((s, m) => s + m.value, 0), -1, 1)
export const cellsOfNationRegion = (ctx, nation, region) => Object.values(cellsOf(ctx)).filter(c => c.nation === nation && c.region === region)
export { RECORDS, EXTENSIVE }
export const addOpinionMod = (c, mod) => (c.opinionGovMods ??= []).push(mod)
