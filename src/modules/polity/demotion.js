// polity/demotion.js — Demotion Duty: net-position-triggered, coercive. Independent checklist entry from Mobility (Rule 12): net position is the TRIGGER,
// the Prestige gap decides the destination cell.
import { transferCohort, opinionModDecay } from './transfer.js'
import { addOpinionMod, cellsOf, cellsOfNationRegion, clamp, countryOfKey } from './cellstate.js'
/** net_position = Wealth + claims - obligations owed (derived, never stored). */
export function netPosition(ctx, key) {
  const c = cellsOf(ctx)[key]; let claims = 0, owed = 0
  for (const o of ctx.state.economy.obligations) { if (o.creditor === key) claims += o.principal; if (o.debtor === key) owed += o.principal + (o.arrears ?? 0) }
  return c.wealth + claims - owed }
export const demotionScalar = (ctx, key) => clamp(Number(ctx.derive.polity.duty(key, 'Demotion', 0)) || 0, 0, 1)         // silence: duty not claimed
/** Destination = same-(Nation, Region) cell with the closest Prestige strictly below the origin's; none below -> nowhere to demote to. */
export function demotionTarget(ctx, origin) {
  const p0 = ctx.derive.polity.prestige(origin.key); let best = null, bestGap = Infinity
  for (const c of cellsOfNationRegion(ctx, origin.nation, origin.region)) { if (c === origin) continue
    const gap = p0 - ctx.derive.polity.prestige(c.key); if (gap > 0 && gap < bestGap) { best = c; bestGap = gap } }
  return best }
export function stepDemotion(ctx) {
  const T = ctx.T, out = [], gains = {}
  for (const key of Object.keys(cellsOf(ctx)).sort()) {
    const c = cellsOf(ctx)[key]; if (!c) continue
    const duty = demotionScalar(ctx, key); if (duty <= 0 || netPosition(ctx, key) >= 0) continue
    const dest = demotionTarget(ctx, c); if (!dest) continue
    const frac = duty * T('demo.rate') * ctx.derive.polity.compliance(key).involuntary                 // delivered = claimed x involuntary compliance
    const before = c.population, moved = transferCohort(ctx, c, dest, frac); if (moved <= 0) continue
    out.push({ from: key, to: dest.key, moved })
    const country = countryOfKey(ctx, key); gains[country] = (gains[country] ?? 0) + T('demo.control') * moved        // real Control gain for the Government
    addOpinionMod(c, { id: `demo.${ctx.state.meta.turn}`, value: -T('demo.opinion') * (moved / Math.max(1, before)), decay: { kind: 'exp', rateKey: 'demo.opinionDecay' }, turn: ctx.state.meta.turn })   // heavy, near-permanent
    addOpinionMod(dest, { id: `demoIn.${ctx.state.meta.turn}`, value: -T('demo.destResent') * (moved / Math.max(1, dest.population)), decay: opinionModDecay, turn: ctx.state.meta.turn }) }
  for (const [country, g] of Object.entries(ctx.state.admin.governments)) g.controlBonus = gains[country] ?? 0    // applies from the next resolution (Administration.controlSupply)
  if (out.length) ctx.bump()
  return out }
