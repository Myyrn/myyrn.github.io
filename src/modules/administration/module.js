// administration/module.js — Control dial -> involuntary compliance; Observation; slate (step 6 minimal).
import { resolveAllocation, grantFor } from '../../kernel/allocation.js'
import { parseCellKey } from '../../kernel/ids.js'
import { covers } from '../../kernel/scope.js'
export function scopeCtx(ctx, country) {
  const keys = Object.keys(ctx.state.polity.cells).filter(k => ctx.derive.worldmap.regionOwner(parseCellKey(k).region) === country)
  return { country, cellKeys: () => keys, cellCountry: k => ctx.derive.worldmap.regionOwner(parseCellKey(k).region), T: ctx.T }
}
const gov = (ctx, c) => ctx.state.admin.governments[c]
export const administrationModule = { id: 'administration', derive: {
  controlSupply: (ctx, country) => Math.max(0, (gov(ctx, country).controlSupply ?? ctx.derive.economics.produceCCO(country).control) + (gov(ctx, country).controlBonus ?? 0) - (ctx.derive.war?.martialCost?.(country) ?? 0)),   // minus the martial-law Control cost of held cells   // controlBonus: coercion gains (Demotion Duty)
  controlResult: (ctx, country) => resolveAllocation(gov(ctx, country).controlDial ?? { entries: [] }, ctx.derive.administration.controlSupply(country), scopeCtx(ctx, country)),
  controlGrant: (ctx, key) => { const c = ctx.derive.worldmap.regionOwner(parseCellKey(key).region)
    return grantFor(ctx.derive.administration.controlResult(c), key) },
} }
