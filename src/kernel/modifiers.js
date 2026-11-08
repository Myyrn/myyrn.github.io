// kernel/modifiers.js — ModifierStack: baseline + decaying modifiers. No spend API by design.
/** @typedef {{id:string,value:number,decay:object,turn:number,source?:string}} Mod */
/** @typedef {{baseline:number,mods:Mod[],lo?:number,hi?:number}} ModifierStack */
export const makeStack = (baseline = 0, lo, hi) => ({ baseline, mods: [], ...(lo !== undefined && { lo }), ...(hi !== undefined && { hi }) })
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))
export const value = s => clamp(s.baseline + s.mods.reduce((a, m) => a + m.value, 0), s.lo ?? -Infinity, s.hi ?? Infinity)
export const push = (s, mod) => { s.mods.push(mod); return s }

/** ctx.T(key) tuning; ctx.decayFns[name](ctx, mod) for {kind:'ctx'} (rate read from CURRENT state, never crisis age). */
export function rateOf(decay, ctx, mod) {
  switch (decay.kind) {
    case 'exp': return ctx.T(decay.rateKey)
    case 'linear': return ctx.T(decay.stepKey) / Math.max(Math.abs(mod.value), 1e-9)   // fraction of |value| removed
    case 'none': return 0
    case 'ctx': return ctx.decayFns[decay.fn](ctx, mod)
    default: throw new Error(`unknown decay ${decay.kind}`)
  }
}
export function tick(s, ctx) {
  for (const m of s.mods) m.value *= 1 - clamp(rateOf(m.decay, ctx, m), 0, 1)
  s.mods = s.mods.filter(m => Math.abs(m.value) > ctx.T('eps.modifier'))
  return s
}
