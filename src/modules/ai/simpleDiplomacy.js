// ai/simpleDiplomacy.js — minimal AI Diplomacy: AI Countries recognise a rebel bloc whose people are their own titular/kin Nation, and offer it a Guarantee.
// Same Action API as the player (Actions Rule 1). Leverage weighting and instrument selection stay with the real AI-Diplomacy layer (later).
export function simpleDiplomacyOrders(ctx) {
  const out = [], W = ctx.state.war, D = ctx.state.diplomacy
  for (const bloc of Object.values(W.blocs ?? {}).filter(b => b.status === 'active')) {
    const pop = {}; for (const c of Object.values(ctx.state.polity.cells)) if (c.flags?.rebel === bloc.id) pop[c.nation] = (pop[c.nation] ?? 0) + c.population
    const nation = Object.entries(pop).sort((a, b) => b[1] - a[1])[0]?.[0]; if (!nation) continue
    for (const [cid, c] of Object.entries(ctx.state.countries)) {
      if (c.isPlayer || cid === bloc.country || !(c.titularNations ?? []).includes(nation)) continue
      const recognised = D.recognition[bloc.id]?.recognizers.includes(cid)
      if (!recognised) out.push({ id: `ai.rec.${cid}.${bloc.id}`, actor: { kind: 'government', country: cid }, type: 'recognizeBloc', params: { bloc: bloc.id }, visibility: 'public' })
      else if (!D.treaties.some(t => t.status === 'active' && t.tier === 'Guarantee' && t.parties?.[0] === cid && t.parties[1] === bloc.id) && !D.proposals.some(p => p.from === cid && p.to === bloc.id))
        out.push({ id: `ai.gua.${cid}.${bloc.id}`, actor: { kind: 'government', country: cid }, type: 'proposeTreaty', params: { to: bloc.id, kind: 'Alliance', tier: 'Guarantee', guarantor: cid }, visibility: 'public' }) } }
  return out }
