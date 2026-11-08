// kernel/stance.js — the shared skin/skeleton: stance = material self-interest × modifier.
export const stance = (party, proposal, ctx, { selfInterest, modifier }) =>
  selfInterest(party, proposal, ctx) * modifier(party, proposal, ctx)
export const approves = (s, ctx) => s >= ctx.T('stance.approve')
