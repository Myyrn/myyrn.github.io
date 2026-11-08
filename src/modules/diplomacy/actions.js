// diplomacy/actions.js — proposeTreaty, answerProposal, imposeSanction, denounceTreaty, grantFacilitation, recognizeBloc (+ the pseudo-type ratifyTreaty used by consent).
import { D, KINDS, ALLIANCE_TIERS, isCountry, treatiesOf, sum } from './common.js'
import { greatPowerBacked, grantCB, addReputation, treatyTier } from './readouts.js'
import { denounce, recognize, militaryCap } from './treaties.js'
const clampN = x => Math.min(1, Math.max(0, x))
const axisOk = (ctx, axes) => (axes ?? []).every(g => ctx.ruleset.axes?.[g.axis] && !ctx.ruleset.axes[g.axis].postAlpha)
const party = (ctx, id) => isCountry(ctx, id) || !!ctx.state.war.blocs?.[id]

export function registerDiplomacyActions(reg) {
  reg.register({ id: 'proposeTreaty', module: 'diplomacy', class: 'event', gateDomain: () => 'treaty', defaultVisibility: 'public', costs: () => [], axisLoads: { ruthlessness_restraint: 1 },
    validate: (ctx, a) => { const p = a.params ?? {}, from = a.actor.country
      if (!KINDS.includes(p.kind) || p.kind === 'Sanction') return { ok: false, reasons: ['kind must be Dependency, Alliance, Confederation or Cooperation (a Sanction is imposed)'] }
      if (!party(ctx, p.to) || p.to === from) return { ok: false, reasons: ['unknown or self counterpart'] }
      if (!isCountry(ctx, p.to) && !(p.kind === 'Alliance' && p.tier === 'Guarantee' && p.guarantor === from)) return { ok: false, reasons: ['a rebel bloc can only be offered a Guarantee'] }
      if (p.kind === 'Alliance' && !ALLIANCE_TIERS.includes(p.tier)) return { ok: false, reasons: ['unknown alliance tier'] }
      if (!axisOk(ctx, p.axes)) return { ok: false, reasons: ['unknown or post-alpha axis'] }
      if (p.kind === 'Dependency' && ![from, p.to].includes(p.overlord)) return { ok: false, reasons: ['overlord must be a party'] }
      if (D(ctx).proposals.some(x => x.status === 'pending' && x.from === from && x.to === p.to && x.kind === p.kind && x.tier === p.tier)) return { ok: false, reasons: ['an identical proposal is pending'] }
      return { ok: true } },
    apply: (ctx, a) => { const p = a.params; D(ctx).proposals.push({ id: ctx.nextId('pr'), from: a.actor.country, to: p.to, kind: p.kind, tier: p.tier, axes: p.axes ?? [], cooperation: p.cooperation, guarantor: p.guarantor, overlord: p.overlord, subject: p.overlord ? (p.overlord === a.actor.country ? p.to : a.actor.country) : undefined, amend: p.amend, turn: ctx.state.meta.turn, status: 'pending' }) } })
  reg.register({ id: 'answerProposal', module: 'diplomacy', class: 'event', gateDomain: () => null, defaultVisibility: 'public', costs: () => [],
    validate: (ctx, a) => (D(ctx).proposals.some(p => p.id === a.params?.id && p.to === a.actor.country && p.status === 'pending') ? { ok: true } : { ok: false, reasons: ['no such pending proposal to you'] }),
    apply: (ctx, a) => { const p = D(ctx).proposals.find(x => x.id === a.params.id); if (a.params.accept) p.accepted = true; else { p.status = 'rejected'; p.reason = 'declined by recipient' } } })
  // Sanction: imposed (≥1 imposer, ad hoc or great-power-backed). Ad hoc sanctions give the target a Grievance-tier CB; a great-power-backed one does not.
  reg.register({ id: 'imposeSanction', module: 'diplomacy', class: 'event', gateDomain: () => 'treaty', defaultVisibility: 'public', costs: () => [], axisLoads: { ruthlessness_restraint: -1 },
    validate: (ctx, a) => { const p = a.params ?? {}; if (!isCountry(ctx, p.target) || p.target === a.actor.country) return { ok: false, reasons: ['unknown target'] }
      if (!axisOk(ctx, p.axes) || !(p.axes ?? []).length) return { ok: false, reasons: ['a Sanction needs at least one axis'] }
      return { ok: true } },
    apply: (ctx, a) => { const p = a.params, existing = treatiesOf(ctx).find(t => t.kind === 'Sanction' && t.target === p.target && JSON.stringify(t.axes) === JSON.stringify(p.axes))
      let t; if (existing) { if (!existing.imposers.includes(a.actor.country)) existing.imposers.push(a.actor.country); t = existing }
      else { t = { id: ctx.nextId('tr'), kind: 'Sanction', status: 'active', since: ctx.state.meta.turn, imposers: [a.actor.country], target: p.target, axes: p.axes, stripsCB: !!p.stripsCB }; D(ctx).treaties.push(t) }
      t.backed = greatPowerBacked(ctx, t.imposers)
      if (!t.backed) grantCB(ctx, p.target, a.actor.country, 'Grievance', 'ad-hoc-sanction', ctx.T('cb.mag.sanction'))
      addReputation(ctx, p.target, a.actor.country, -ctx.T('rep.sanction'), 'sanction'); ctx.bump() } })
  reg.register({ id: 'denounceTreaty', module: 'diplomacy', class: 'event', gateDomain: () => 'treaty', defaultVisibility: 'public', costs: () => [], axisLoads: { ruthlessness_restraint: -1 },
    validate: (ctx, a) => { const t = D(ctx).treaties.find(x => x.id === a.params?.id && x.status === 'active'); return t && (t.parties ?? [t.overlord, t.subject, t.target, ...(t.imposers ?? [])]).includes(a.actor.country) ? { ok: true } : { ok: false, reasons: ['not a party to an active treaty'] } },
    apply: (ctx, a) => denounce(ctx, D(ctx).treaties.find(x => x.id === a.params.id), a.actor.country) })
  // FacilitationGrant: lightest tier, a scoped micro-Right. Here a real zero-sum transfer of a good from the grantor's warehouse to the grantee's (a Country's capital area or a bloc's held province).
  reg.register({ id: 'grantFacilitation', module: 'diplomacy', class: 'event', gateDomain: () => null, defaultVisibility: 'covert', costs: () => [],
    validate: (ctx, a) => { const p = a.params ?? {}, W = ctx.state.economy.warehouses; if (!(p.qty > 0) || !party(ctx, p.to) || p.to === a.actor.country) return { ok: false, reasons: ['qty, to required'] }
      return (W[p.from]?.stock?.[p.good] ?? 0) >= p.qty && ctx.state.world.provinces[p.from]?.owner === a.actor.country ? { ok: true } : { ok: false, reasons: ['grantor province must hold the stock'] } },
    apply: (ctx, a) => { const p = a.params, W = ctx.state.economy.warehouses, bloc = ctx.state.war.blocs?.[p.to]
      const dest = p.dest ?? (bloc ? Object.keys(ctx.state.war.occupations).find(x => ctx.state.war.occupations[x].occupier === p.to) : Object.keys(ctx.state.world.provinces).find(x => ctx.state.world.provinces[x].owner === p.to))
      if (!dest || !W[dest]) return; W[p.from].stock[p.good] -= p.qty; W[dest].stock[p.good] = (W[dest].stock[p.good] ?? 0) + p.qty
      D(ctx).grants.push({ id: ctx.nextId('fg'), grantor: a.actor.country, to: p.to, good: p.good, qty: p.qty, turn: ctx.state.meta.turn, dest }) } })
  // Recognition of a rebel bloc (Countries kb): a foreign Government's Event. Rebels take this route when their goal is independence or the Government refused them.
  reg.register({ id: 'recognizeBloc', module: 'diplomacy', class: 'event', gateDomain: () => 'treaty', defaultVisibility: 'public', costs: () => [], axisLoads: { ruthlessness_restraint: -1 },
    validate: (ctx, a) => { const b = ctx.state.war.blocs?.[a.params?.bloc]; if (!b || b.status !== 'active') return { ok: false, reasons: ['no such active bloc'] }
      if (a.actor.country === b.country) return { ok: false, reasons: ['the parent cannot recognise its own rebels'] }
      const iw = ctx.state.war.wars.find(w => w.internal && w.b === b.id); if (!(b.goal === 'independence' || iw?.lastProposal?.accepted === false)) return { ok: false, reasons: ['the rebels have not taken the recognition route'] }
      return D(ctx).recognition[b.id]?.recognizers.includes(a.actor.country) ? { ok: false, reasons: ['already recognised'] } : { ok: true } },
    apply: (ctx, a) => recognize(ctx, a.params.bloc, a.actor.country) })
  // pseudo-type: only used to consult the treaty Veto holders (consent machinery); never submitted
  reg.register({ id: 'ratifyTreaty', module: 'diplomacy', class: 'event', gateDomain: () => 'treaty', defaultVisibility: 'public', costs: () => [], axisLoads: {}, validate: () => ({ ok: false, reasons: ['internal'] }),
    impact: (ctx, a) => { const p = a.params, n = (p.axes ?? []).length, subject = p.kind === 'Dependency' && p.subject === a.actor.country
      return { cost: clampN((subject ? ctx.T('treaty.cellAxisCost') * n : 0) + (p.kind === 'Alliance' && p.tier !== 'Guarantee' && p.tier !== 'BenevolentNeutrality' ? ctx.T('treaty.cellPactCost') : 0) + ctx.T('treaty.cellAxisCost') * n * ctx.T('treaty.cellConfShare')), relief: p.kind === 'Cooperation' ? ctx.T('treaty.cellCoopRelief') : 0 } },
    apply: () => {} })
}
