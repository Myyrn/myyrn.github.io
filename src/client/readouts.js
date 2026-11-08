// client/readouts.js — the UI's read side: named, JSON-serialisable queries over a read-only ctx. No game data is stored here (UI Rule 4); every number is a derived readout
// or a field of State. Every query takes (client, ctx, args). The UI never touches State or the engine directly.
import { validate, gate } from '../engine/engine.js'
import { covers } from '../kernel/scope.js'
import { parseCellKey } from '../kernel/ids.js'
import { scopeCtx } from '../modules/administration/module.js'
import { effectivePref } from '../modules/polity/cellstate.js'
import { zones, zoneEdges, throughputCap } from '../modules/economics/derive.js'
import { activeCBs, reputation, leverage, greatPowerBacked, treatyTier, power } from '../modules/diplomacy/readouts.js'
import { convergenceCandidates } from '../modules/polity/convergence.js'
import { amalgam } from '../modules/polity/propaganda.js'
const sum = a => a.reduce((s, x) => s + x, 0), r2 = x => Math.round(x * 100) / 100
const owner = (ctx, c) => ctx.derive.worldmap.regionOwner(c.region)
const cellsOf = (ctx, country) => Object.values(ctx.state.polity.cells).filter(c => !country || owner(ctx, c) === country).sort((a, b) => (a.key < b.key ? -1 : 1))
const provincesOf = (ctx, country) => Object.entries(ctx.state.world.provinces).filter(([, p]) => !country || p.owner === country).map(([id]) => id)
export const PORTRAIT_AXES = ['extraction_investment', 'homogenizing_pluralist', 'fervor_secular', 'ruthlessness_restraint', 'conservatism_reformism']

export const readouts = {
  /** Nation x Estate x Region matrix rows (the Estates tab and the Docked cell card read these). */
  estates(client, ctx, { country }) {
    return cellsOf(ctx, country).map(c => ({ key: c.key, nation: c.nation, estate: c.estate, region: c.region, population: Math.round(c.population), wealth: Math.round(c.wealth), opinion: r2(ctx.derive.polity.opinionGov(c.key)),
      prestige: r2(ctx.derive.polity.prestige(c.key)), weight: Math.round(ctx.derive.polity.weight(c.key)), awareness: r2(ctx.derive.polity.awareness(c.key)), satisfaction: c.satisfaction ?? {}, grievance: c.grievance ?? {},
      compliance: ctx.derive.polity.compliance(c.key), rung: ctx.derive.polity.cellRung(c.key), pref: Object.fromEntries(PORTRAIT_AXES.map(a => [a, r2(effectivePref(c, a))])), flags: c.flags ?? {} })) },
  /** Live Questions sorted by severity + the derived, Question-scoped groupings (blocs). Never persistent entities. */
  questions(client, ctx, { country }) {
    const mine = k => owner(ctx, ctx.state.polity.cells[k]) === country, qs = ctx.derive.polity.questions().filter(q => mine(q.cell)).map(q => ({ ...q, momentum: r2(ctx.state.polity.momentum[`${q.cell}|${q.need}`] ?? 0), rung: ctx.state.polity.rung[`${q.cell}|${q.need}`] ?? 0, population: Math.round(ctx.state.polity.cells[q.cell].population) }))
    const order = { existential: 0, structural: 1, routine: 2 }; qs.sort((a, b) => order[a.tier] - order[b.tier] || b.gap - a.gap)
    return { questions: qs, routine: qs.filter(q => q.tier === 'routine').length, blocs: (ctx.derive.polity.factions() ?? []).filter(f => (f.blocs ? true : true)).map(f => structuredClone(f)).slice(0, 40), note: 'Government slate/attention line: not modelled yet (Questions are shown by severity)' } },
  /** Rights/Duties entries (rows) x Scope columns (Empire, Estates, Nations): effective value, inherited vs overridden; silence shown as the default. */
  laws(client, ctx, { country }) {
    const cells = cellsOf(ctx, country), law = ctx.state.polity.law[country] ?? { rights: {}, duties: {} }, sc = scopeCtx(ctx, country)
    const cols = [{ key: 'empire', label: 'Empire', scope: { kind: 'empire' } }, ...[...new Set(cells.map(c => c.estate))].sort().map(e => ({ key: `e:${e}`, label: e, scope: { kind: 'estate', estate: e } })), ...[...new Set(cells.map(c => c.nation))].sort().map(n => ({ key: `n:${n}`, label: n, scope: { kind: 'nation', nation: n } }))]
    const rows = []
    for (const [kind, defs] of [['rights', ctx.ruleset.rights ?? {}], ['duties', ctx.ruleset.duties ?? {}]]) for (const [id, def] of Object.entries(defs)) {
      const entries = law[kind]?.[id] ?? [], cs = {}
      for (const col of cols) { const covered = cells.filter(c => covers(col.scope, c.key, sc)), vals = [...new Set(covered.map(c => JSON.stringify(kind === 'rights' ? ctx.derive.polity.right(c.key, id) : ctx.derive.polity.duty(c.key, id) ?? null)))]
        cs[col.key] = { value: vals.length === 1 ? JSON.parse(vals[0]) : null, mixed: vals.length > 1, overridden: entries.some(e => JSON.stringify(e.scope) === JSON.stringify(col.scope)), cells: covered.length } }
      rows.push({ kind, id, valueType: def.valueType ?? null, silentDefault: def.silentDefault ?? null, entries: structuredClone(entries), cols: cs }) }
    return { columns: cols, rows, convergence: convergenceCandidates(ctx), mobilityGap: structuredClone(ctx.state.polity.mobilityGap?.[country] ?? {}) } },
  govCard(client, ctx, { country }) {
    const g = ctx.state.admin.governments[country], cco = ctx.derive.economics.produceCCO(country), law = ctx.state.polity.law[country] ?? {}
    return { country, ledger: r2(g.ledger), upkeepFraction: r2(g.upkeepFraction ?? 0), cco, controlSupply: r2(ctx.derive.administration.controlSupply(country)), controlBonus: r2(g.controlBonus ?? 0), martialCost: r2(ctx.derive.war.martialCost(country)),
      controlDial: structuredClone(g.controlDial ?? { entries: [] }), observationDial: structuredClone(g.observationDial ?? { entries: [] }), spendingDial: structuredClone(g.spendingDial ?? { entries: [] }),
      tax: structuredClone(law.duties?.Taxation ?? []), requisitions: structuredClone(law.requisitions ?? []), amalgam: Object.fromEntries(Object.entries(amalgam(ctx, country)).map(([k, v]) => [k, r2(v)])),
      propaganda: ctx.state.commitments.filter(c => c.type === 'propaganda' && c.actor.kind === 'government' && c.actor.country === country).map(c => ({ id: c.id, amount: c.params.amount, ideal: c.params.ideal ?? null, targets: c.params.targets })), propagandaDraw: ctx.derive.polity.propagandaDraw(country) } },
  economy(client, ctx, { country }) {
    const cells = cellsOf(ctx, country), ps = provincesOf(ctx, country), W = ctx.state.economy.warehouses, lvl = ctx.derive.economics.priceLevel(), M = ctx.state.economy.lastMarket ?? {}
    const pools = Object.entries(ctx.ruleset.pools).map(([id, d]) => { const total = sum(cells.map(c => c.labour[id] ?? 0)), com = sum(cells.map(c => c.labourCommitted?.[id] ?? 0)); return { id, kind: d.kind, total: Math.round(total), committed: Math.round(com), free: Math.round(total - com) } })
    const zs = zones(ctx), zoneIds = Object.keys(zs).filter(z => ctx.state.world.provinces[z]?.owner === country || zs[z].some(p => ps.includes(p)))
    const goods = Object.entries(ctx.ruleset.goods).map(([id, d]) => ({ id, tier: d.tier, baseValue: d.baseValue, perishable: !!d.perishable, stock: Math.round(sum(ps.map(p => W[p]?.stock?.[id] ?? 0))),
      zones: Object.fromEntries(zoneIds.map(z => [z, { stock: Math.round(M[z]?.[id]?.stock ?? 0), demand: Math.round(M[z]?.[id]?.demand ?? 0), price: r2(M[z]?.[id]?.price ?? d.baseValue * lvl) }])) }))
    const edges = zoneEdges(ctx).map(([a, b]) => ({ a, b, cap: r2(throughputCap(ctx, a, b)), cross: ctx.state.world.provinces[a]?.owner !== ctx.state.world.provinces[b]?.owner })).filter(e => zoneIds.includes(e.a) || zoneIds.includes(e.b))
    const mine = new Set(cells.map(c => c.key)), obligations = ctx.state.economy.obligations.filter(o => mine.has(o.debtor) || mine.has(o.creditor))
    return { pools, goods, zones: zoneIds.map(z => ({ hub: z, provinces: zs[z].length, owner: ctx.state.world.provinces[z]?.owner })), edges, priceLevel: r2(lvl), coinage: structuredClone(ctx.state.economy.coinage), obligations: structuredClone(obligations),
      ledger: r2(ctx.state.admin.governments[country].ledger), lastOutput: Math.round(sum(ps.map(p => ctx.state.economy.lastOutput?.[p] ?? 0))), note: 'price = base x scarcity x price_level (cached at the last resolution)' } },
  /** Ego-centred relations: one row per other Country with the pair sheet inputs. */
  world(client, ctx, { country }) {
    const ids = Object.keys(ctx.state.countries).filter(c => c !== country)
    return { me: country, others: ids.map(o => ({ id: o, name: ctx.state.countries[o].name, color: ctx.state.countries[o].color, tier: treatyTier(ctx, country, o), reputationOfThem: r2(reputation(ctx, country, o)), reputationOfMe: r2(reputation(ctx, o, country)), power: r2(power(ctx, o)) })), myPower: r2(power(ctx, country)),
      treaties: ctx.state.diplomacy.treaties.filter(t => t.status === 'active').map(t => structuredClone(t)), edges: ctx.state.diplomacy.treaties.filter(t => t.status === 'active').map(t => ({ id: t.id, kind: t.kind, tier: t.tier, parties: t.kind === 'Dependency' ? [t.overlord, t.subject] : t.kind === 'Sanction' ? [...t.imposers, t.target] : t.parties })) } },
  pair(client, ctx, { a, b }) {
    const L = leverage(ctx, a, b), cbs = o => activeCBs(ctx, o.h, o.t).map(c => ({ tier: c.tier, reason: c.reason, class: c.class, recognised: c.recognised }))
    return { a, b, reputation: { aOfB: r2(reputation(ctx, a, b)), bOfA: r2(reputation(ctx, b, a)) }, leverage: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, r2(v)])), claims: ctx.state.diplomacy.claims.filter(c => (c.holder === a && c.target === b) || (c.holder === b && c.target === a)),
      cbs: { aAgainstB: cbs({ h: a, t: b }), bAgainstA: cbs({ h: b, t: a }) }, treaties: ctx.state.diplomacy.treaties.filter(t => t.status === 'active' && [t.parties, [t.overlord, t.subject], t.imposers && [...t.imposers, t.target]].filter(Boolean).some(p => p.includes(a) && p.includes(b))).map(t => structuredClone(t)),
      greatPowerBackedA: greatPowerBacked(ctx, [a]), note: 'Dependency satisfaction readout: not modelled yet' } },
  /** Your Country as others see it: Reputational stacks held toward you, CBs against you (state/structural/event). */
  mirror(client, ctx, { country }) {
    const others = Object.keys(ctx.state.countries).filter(c => c !== country)
    return { country, reputation: others.map(o => ({ observer: o, value: r2(reputation(ctx, o, country)) })), cbsAgainstMe: others.map(o => ({ holder: o, cbs: activeCBs(ctx, o, country).map(c => ({ tier: c.tier, reason: c.reason, class: c.class, recognised: c.recognised })) })).filter(x => x.cbs.length),
      portrait: { observed: 'not modelled (the amalgam is the closest readout)', amalgam: Object.fromEntries(Object.entries(amalgam(ctx, country)).map(([k, v]) => [k, r2(v)])) } } },
  treaties(client, ctx, { country }) {
    const D = ctx.state.diplomacy; return { active: D.treaties.filter(t => t.status === 'active' && JSON.stringify(t).includes(`"${country}"`)).map(t => structuredClone(t)), proposals: D.proposals.map(p => ({ ...p, incoming: p.to === country, outgoing: p.from === country })).filter(p => p.incoming || p.outgoing),
      rejected: (D.rejected ?? []).slice(-5), axes: Object.entries(ctx.ruleset.axes ?? {}).map(([id, d]) => ({ id, doc: d.doc, postAlpha: !!d.postAlpha })), grants: D.grants.filter(g => g.grantor === country || g.to === country) } },
  military(client, ctx, { country }) {
    const W = ctx.state.war, armies = Object.values(W.armies).map(a => ({ id: a.id, owner: a.owner, position: a.position, destination: a.destination, tactic: a.tactic, stance: a.stance,
      men: Math.round(sum(a.units.map(u => W.units[u].n))), cohesion: r2(sum(a.units.map(u => W.units[u].cohesion)) / (a.units.length || 1)), supply: r2(sum(a.units.map(u => W.units[u].supply)) / (a.units.length || 1)),
      composition: Object.fromEntries(a.units.map(u => [W.units[u].pool, Math.round(W.units[u].n)])) }))
    return { armies, mine: armies.filter(a => a.owner === country), wars: W.wars.filter(w => [w.a, w.b].includes(country) || w.chained).map(w => ({ ...structuredClone(w) })), blocs: Object.values(W.blocs ?? {}).map(b => ({ ...structuredClone(b), recognisers: ctx.state.diplomacy.recognition[b.id]?.recognizers ?? [] })),
      occupations: Object.entries(W.occupations).map(([p, o]) => ({ province: p, ...o })), exhaustion: r2(ctx.derive.war.countryExhaustion(country) ?? 0), score: W.score.slice(-12) } },
  commitments(client, ctx, { country }) {
    const out = [], W = ctx.state.war
    for (const a of Object.values(W.armies).filter(x => x.owner === country)) out.push({ kind: 'army', id: a.id, text: `army ${a.id} @ ${a.position}`, men: Math.round(sum(a.units.map(u => W.units[u].n))) })
    for (const c of ctx.state.commitments.filter(c => c.actor.country === country || (c.actor.key && owner(ctx, ctx.state.polity.cells[c.actor.key] ?? { region: null }) === country))) out.push({ kind: c.type, id: c.id, text: `${c.type} ${JSON.stringify(c.params).slice(0, 80)}`, since: c.since })
    return out },
  provinceCard(client, ctx, { id }) {
    const p = ctx.state.world.provinces[id], reg = ctx.state.world.regionSnapshot.assignment[id], wh = ctx.state.economy.warehouses[id], W = ctx.state.war
    return { id, region: reg, terrain: p.terrain, forestation: p.forestation, habitability: p.habitability, waterSource: p.waterSource, population: Math.round(p.population), owner: p.owner, controller: W.occupations[id]?.occupier ?? p.owner,
      infrastructure: r2(p.infrastructureLevel ?? 0), tradeInfrastructure: r2(ctx.state.economy.tradeInfra[id] ?? p.tradeInfrastructureLevel ?? 0), stock: Object.fromEntries(Object.entries(wh?.stock ?? {}).filter(([, v]) => v > 1).map(([g, v]) => [g, Math.round(v)]).sort((a, b) => b[1] - a[1]).slice(0, 8)),
      presence: Object.fromEntries(Object.entries(ctx.state.nations.presence[id] ?? {}).map(([n, v]) => [n, Math.round(v)])), cells: cellsOf(ctx).filter(c => c.region === reg).map(c => c.key), armies: Object.values(W.armies).filter(a => a.position === id).map(a => a.id) } },
  /** Actor-cell card: bullet-bar inputs, compliance breakdown, the Control allocation affecting the cell with each contributing filter, effective Rights/Duties. */
  cellCard(client, ctx, { key }) {
    const c = ctx.state.polity.cells[key], country = owner(ctx, c), res = ctx.derive.administration.controlResult(country), law = ctx.state.polity.law[country] ?? {}
    return { key, country, population: Math.round(c.population), wealth: Math.round(c.wealth), opinion: r2(ctx.derive.polity.opinionGov(key)), prestige: r2(ctx.derive.polity.prestige(key)), weight: Math.round(ctx.derive.polity.weight(key)), awareness: r2(ctx.derive.polity.awareness(key)),
      satisfaction: c.satisfaction ?? {}, grievance: c.grievance ?? {}, compliance: ctx.derive.polity.compliance(key), rung: ctx.derive.polity.cellRung(key), pref: Object.fromEntries(PORTRAIT_AXES.map(a => [a, r2(effectivePref(c, a))])),
      controlFilters: (res.rows ?? []).filter(r => r.u === key).map(r => ({ entry: r.i, floor: r.floor, priority: r.priority, weight: r.w, grant: r.grant })), controlGrant: r2(ctx.derive.administration.controlGrant(key)),
      rights: Object.keys(ctx.ruleset.rights ?? {}).map(id => [id, ctx.derive.polity.right(key, id)]).filter(([, v]) => v !== undefined && v !== false && v !== 0), duties: Object.keys(ctx.ruleset.duties ?? {}).map(id => [id, ctx.derive.polity.duty(key, id)]).filter(([, v]) => v !== undefined && v !== null),
      labour: Object.fromEntries(Object.entries(c.labour).map(([p, v]) => [p, Math.round(v)]).filter(([, v]) => v > 0)), flags: c.flags ?? {}, escalation: Object.entries(ctx.state.polity.rung ?? {}).filter(([k]) => k.startsWith(key + '|') && Number(k.split('|')[3] !== undefined) && ctx.state.polity.rung[k] > 0).map(([k, v]) => ({ need: k.split('|')[3], rung: v })), hasLaw: !!law } },
  /** Lens data per land province at its native resolution (cells are Region-resolution: spread over the Region's provinces, never smoothed). */
  lens(client, ctx, { lens, param, country }) {
    const P = ctx.state.world.provinces, W = ctx.state.economy.warehouses, asg = ctx.state.world.regionSnapshot.assignment, byRegion = {}
    for (const c of Object.values(ctx.state.polity.cells)) (byRegion[c.region] ??= []).push(c)
    const wavg = (p, f) => { const cs = byRegion[asg[p]] ?? [], pop = sum(cs.map(c => c.population)) || 1; return sum(cs.map(c => f(c) * c.population)) / pop }
    const val = {}
    for (const [id, p] of Object.entries(P)) { let v
      switch (lens) {
        case 'population': v = p.population; break
        case 'subsistence': v = 1 - wavg(id, c => c.satisfaction?.subsistence ?? 1); break
        case 'grievance': v = wavg(id, c => c.grievance?.[param ?? 'subsistence'] ?? 0); break
        case 'unrest': v = Math.max(0, ...(byRegion[asg[id]] ?? []).map(c => ctx.derive.polity.cellRung(c.key))); break
        case 'goods': v = W[id]?.stock?.[param ?? 'Grain'] ?? 0; break
        case 'roads': v = p.infrastructureLevel ?? 0; break
        case 'commerce': v = ctx.state.economy.tradeInfra[id] ?? 0; break
        case 'claims': v = ctx.state.diplomacy.claims.filter(c => c.province === id).length + (ctx.state.war.occupations[id] ? 1 : 0); break
        case 'military': v = sum(Object.values(ctx.state.war.armies).filter(a => a.position === id).map(a => sum(a.units.map(u => ctx.state.war.units[u].n)))); break
        case 'cultural': { const pr = ctx.state.nations.presence[id] ?? {}; v = Object.entries(pr).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; break }
        default: v = null }
      val[id] = v }
    return { lens, param: param ?? null, values: val, max: Math.max(1e-9, ...Object.values(val).filter(x => typeof x === 'number')) } },
  /** Scope tree (Nation > Estate > Region by default; the order is the player's SliceOrder) with any extensive measure; the hottest child marks where unrest concentrates. */
  scopeTree(client, ctx, { country, order = ['nation', 'estate', 'region'], measure = 'population' }) {
    const cells = cellsOf(ctx, country), val = c => (measure === 'wealth' ? c.wealth : c.population), heat = c => Math.max(0, ...Object.values(c.grievance ?? {}), 0)
    const build = (cs, depth) => { if (depth === order.length) return null; const by = {}; for (const c of cs) (by[c[order[depth]]] ??= []).push(c)
      return Object.entries(by).map(([k, list]) => ({ key: k, level: order[depth], value: Math.round(sum(list.map(val))), heat: r2(Math.max(...list.map(heat))), children: build(list, depth + 1) })).sort((a, b) => b.value - a.value) }
    const tree = build(cells, 0), mark = nodes => { if (!nodes?.length) return; const hot = nodes.reduce((a, b) => (b.heat > a.heat ? b : a)); hot.hottest = true; nodes.forEach(n => mark(n.children)) }; mark(tree)
    return { order, measure, tree, total: Math.round(sum(cells.map(val))) } },
  /** Ruleset lists the forms need (ids only). */
  rules(client) { const r = client.ruleset; return { rights: Object.keys(r.rights ?? {}), duties: Object.keys(r.duties ?? {}), goods: Object.keys(r.goods ?? {}), armyPools: Object.entries(r.pools).filter(([, v]) => v.kind === 'army').map(([k]) => k),
    axes: Object.entries(r.axes ?? {}).map(([id, d]) => ({ id, doc: d.doc, postAlpha: !!d.postAlpha })), axisNames: PORTRAIT_AXES, needs: Object.keys(r.needs ?? {}), terrain: Object.keys(r.terrain ?? {}) } },
  orders(client) { return structuredClone(client.orders) },
  catalog(client) { return [...client.registry.types.values()].filter(t => t.id !== 'ratifyTreaty' && !t.cellAvailability).map(t => ({ id: t.id, module: t.module, class: t.class, gated: !!t.gateDomain })) },
  /** Event Draft preview: validation, class, gating verdict (who refuses) — nothing is executed. */
  preview(client, ctx, { order }) {
    const a = { id: 'preview', visibility: 'public', ...order }; let t; try { t = ctx.registry.get(a.type) } catch (e) { return { valid: false, reasons: [e.message] } }
    const v = validate(ctx, a); if (v.ok === false) return { valid: false, reasons: v.reasons ?? ['invalid'], class: t.class }
    const g = gate(ctx, a); return { valid: true, class: t.class, gateDomain: t.gateDomain?.(ctx, a) ?? null, blocked: !!g.blocked, holders: g.holders ?? [], foreign: g.foreign ?? [], verdicts: (g.verdicts ?? []).map(x => ({ cell: x.cell, stance: r2(x.s) })), visibility: a.visibility ?? t.defaultVisibility } },
}
