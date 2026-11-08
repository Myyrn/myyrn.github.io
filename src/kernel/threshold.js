// kernel/threshold.js — fixed-threshold actions: binary, no extra benefit beyond threshold, no refund.
export function threshold(actionType, tier, target, ctx) {
  if (typeof actionType.targetScale !== 'function') throw new Error(`action type ${actionType.id} must declare targetScale`)
  return ctx.T(`thresholds.${actionType.id}.${tier}`) * actionType.targetScale(ctx, target)
}
export const applyThreshold = (committed, th) =>
  committed >= th ? { met: true, effect: 'full', used: th } : { met: false, effect: 'none', refunded: false }
