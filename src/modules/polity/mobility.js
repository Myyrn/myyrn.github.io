// polity/mobility.js — Estate Mobility: bottom-up, gradual, permanent (internal_politics__kb "Estate Mobility", Rules 12, 31).
// Moves population between Estate cells inside the same (Nation, Region); between Regions it is migration (World Map).
import { transferCohort, opinionModDecay } from './transfer.js'
import { addOpinionMod, cellsOf, cellsOfNationRegion, clamp } from './cellstate.js'
const pairKey = (from, to) => `${from}>${to}`
export const mobilityGap = (ctx, country, from, to) => ctx.state.polity.mobilityGap?.[country]?.[pairKey(from, to)]      // undefined = no gap set = not eligible
export const mobilityScalar = (ctx, key) => clamp(Number(ctx.derive.polity.right(key, 'EstateMobility') ?? 0) || 0, 0, 1)
/** Eligibility: Prestige(dest) - Prestige(origin) <= max_coverable_gap (Government-set, per Estate pair per direction). */
export function eligible(ctx, origin, dest, country) {
  const gap = mobilityGap(ctx, country, origin.estate, dest.estate); if (gap === undefined) return false
  return ctx.derive.polity.prestige(dest.key) - ctx.derive.polity.prestige(origin.key) <= gap }
export function stepMobility(ctx) {
  const T = ctx.T, out = [], seen = new Set()
  for (const key of Object.keys(cellsOf(ctx)).sort()) {
    const origin = cellsOf(ctx)[key]; if (!origin || origin.population <= 0) continue
    const scalar = mobilityScalar(ctx, key); if (scalar <= 0) continue
    const country = ctx.derive.worldmap.regionOwner(origin.region)
    const dests = cellsOfNationRegion(ctx, origin.nation, origin.region).filter(d => d !== origin && eligible(ctx, origin, d, country)); if (!dests.length) continue
    const total = Math.min(1, scalar * T('mob.eligibleShare')), pop0 = origin.population      // fraction of eligible population converted per turn, split over eligible destinations
    for (const dest of dests) {
      const share = total / dests.length, moved = transferCohort(ctx, origin, dest, origin.population > 0 ? share * pop0 / origin.population : 0); if (moved <= 0) continue
      out.push({ from: key, to: dest.key, moved }); seen.add(key)
      addOpinionMod(origin, { id: `mob+.${ctx.state.meta.turn}`, value: +T('mob.originGain') * share, decay: opinionModDecay, turn: ctx.state.meta.turn })   // both reactions target the Government
      addOpinionMod(dest, { id: `mob-.${ctx.state.meta.turn}`, value: -T('mob.destResent') * (moved / Math.max(1, dest.population)), decay: opinionModDecay, turn: ctx.state.meta.turn }) } }
  if (out.length) ctx.bump()
  return out }
