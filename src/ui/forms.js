// ui/forms.js — Event Draft / dial / commitment forms: one spec per Action type. A draft fills `params`, previews (validate + gating verdict), then queues to the Orders tray.
// Scope-aware actions take the global Scope (ScopePicker) as their `scope`. Pure data + pure builders: no DOM here, so they are unit-tested in Node.
const opt = (v, l = v) => ({ v, l }), opts = a => (a ?? []).map(x => (typeof x === 'object' ? x : opt(x)))
const num = (name, label, def, o = {}) => ({ name, label, type: 'number', default: def, ...o }), sel = (name, label, options, def) => ({ name, label, type: 'select', options: opts(options), default: def ?? opts(options)[0]?.v })
const parseJson = (s, dflt) => { if (s == null || String(s).trim() === '') return { value: dflt }; try { return { value: JSON.parse(s) } } catch { return { error: `not valid JSON: ${String(s).slice(0, 40)}` } } }
const parseValue = s => { const t = String(s).trim(); if (t === 'true') return true; if (t === 'false') return false; if (t === 'remove' || t === 'null') return null; if (t !== '' && !Number.isNaN(Number(t))) return Number(t); const j = parseJson(t); return j.error ? t : j.value }
const axesFrom = (picked, termsJson) => { const t = parseJson(termsJson, {}); if (t.error) return t; return { axes: (picked ?? []).map(axis => ({ axis, terms: t.value?.[axis] ?? {} })) } }
const AXES = o => ({ name: 'axes', label: 'Axes', type: 'multi', options: opts((o.axes ?? []).filter(a => !a.postAlpha).map(a => a.id)) }), TERMS = { name: 'terms', label: 'Terms (JSON keyed by axis)', type: 'json', default: '' }

export const FORMS = {
  setTaxLaw: { group: 'Government', title: 'Tax law', scoped: true, help: 'Market and wealth rates for the chosen Scope (most specific scope wins).',
    fields: o => [num('market', 'Market rate', 0.05, { min: 0, max: 1, step: 0.01 }), num('wealth', 'Wealth rate', 0, { min: 0, max: 1, step: 0.01 })], build: (v, o) => ({ params: { scope: o.scope, market: +v.market, wealth: +v.wealth } }) },
  reformRightsDuties: { group: 'Government', title: 'Reform a Right or Duty', scoped: true, help: 'Set an entry for the chosen Scope. Value: true/false, a number, JSON, or "remove" to delete this scope\'s entry.',
    fields: o => [sel('entry', 'Entry', [...(o.rights ?? []).map(r => opt(`rights:${r}`, `Right · ${r}`)), ...(o.duties ?? []).map(d => opt(`duties:${d}`, `Duty · ${d}`))]), { name: 'value', label: 'Value', type: 'text', default: 'true' }],
    build: (v, o) => { const [kind, id] = String(v.entry).split(':'); return { params: { entries: [{ kind, id, scope: o.scope, value: parseValue(v.value) }] } } } },
  placeRequisition: { group: 'Government', title: 'Requisition', scoped: true, fields: o => [sel('good', 'Good', o.goods), num('amount', 'Share', 0.1, { min: 0, max: 1, step: 0.05 })], build: (v, o) => ({ params: { good: v.good, amount: +v.amount, scope: o.scope } }) },
  setControlAllocation: { group: 'Apparatus', title: 'Control Allocation entry', scoped: true, help: 'One filter of the Allocation Dial: floor + priority + surplus weight. Added to (or replacing) the current dial.',
    fields: () => [num('floor', 'Floor', 0, { min: 0 }), num('priority', 'Priority', 1, { min: 0 }), num('surplusWeight', 'Surplus weight', 1, { min: 0 }), sel('mode', 'Mode', ['add', 'replace'])],
    build: (v, o) => { const e = { target: o.scope, floor: +v.floor, priority: +v.priority, surplusWeight: +v.surplusWeight }; return { params: { entries: v.mode === 'replace' ? [e] : [...(o.gov?.controlDial?.entries ?? []), e] } } } },
  setSpendingDial: { group: 'Apparatus', title: 'Spending reserve', fields: o => [num('reserve', 'Reserve floor', o.gov?.spendingDial?.reserve ?? 0, { min: 0 })],
    build: (v, o) => ({ params: { entries: o.gov?.spendingDial?.entries ?? [], reserve: +v.reserve, sink: o.gov?.spendingDial?.sink ?? 'keep' } }) },
  setMobilityGap: { group: 'Government', title: 'Estate Mobility gap', fields: o => [sel('from', 'From Estate', o.estates), sel('to', 'To Estate', o.estates, o.estates?.[1] ?? o.estates?.[0]), num('gap', 'Max Prestige gap', 1, { step: 0.1 })],
    build: v => (v.from === v.to ? { error: 'pick two different Estates' } : { params: { from: v.from, to: v.to, gap: +v.gap } }) },
  declareConvergence: { group: 'Government', title: 'Declare Estate Convergence', help: 'Merges cell pairs whose Rights and Duties no longer differ (within the Nation/Region filter).', fields: () => [],
    build: (v, o) => ({ params: { scope: o.filter?.nation || o.filter?.region ? { nation: o.filter.nation, region: o.filter.region } : null } }) },
  propaganda: { group: 'Apparatus', title: 'Government propaganda', scoped: true, help: 'Draws on Coordination. Leave the ideal blank to justify the current amalgam; otherwise values in [-1, 1] per Portrait axis.',
    fields: o => [num('amount', 'Coordination directed', 5, { min: 0 }), ...(o.axisNames ?? []).map(a => ({ name: `ideal_${a}`, label: `Ideal · ${a}`, type: 'text', default: '' }))],
    build: (v, o) => { const ideal = {}; for (const a of o.axisNames ?? []) { const t = String(v[`ideal_${a}`] ?? '').trim(); if (t !== '') { if (Number.isNaN(Number(t))) return { error: `${a} must be a number` }; ideal[a] = Math.max(-1, Math.min(1, Number(t))) } }
      return { params: { amount: +v.amount, targets: o.scope, ...(Object.keys(ideal).length ? { ideal } : {}) } } } },
  liftPropaganda: { group: 'Apparatus', title: 'Lift propaganda', fields: o => [sel('id', 'Commitment', o.propaganda)], build: v => (v.id ? { params: { id: v.id } } : { error: 'no propaganda commitment' }) },
  fieldUnits: { group: 'War', title: 'Field an army', fields: o => [sel('originCell', 'Origin cell', o.myCells), sel('pool', 'Army pool', o.armyPools), num('n', 'Men', 20, { min: 1 }), { name: 'at', label: 'Muster at', type: 'text', default: o.selectedProvince ?? '' }],
    build: v => ({ params: { originCell: v.originCell, composition: { [v.pool]: +v.n }, at: v.at || undefined } }) },
  orderMove: { group: 'War', title: 'Order an army to move', fields: o => [sel('armyId', 'Army', o.armies), { name: 'to', label: 'To province', type: 'text', default: o.selectedProvince ?? '' }], build: v => (v.armyId && v.to ? { params: { armyId: v.armyId, to: v.to } } : { error: 'army and destination required' }) },
  setTactic: { group: 'War', title: 'Set army tactic', fields: o => [sel('armyId', 'Army', o.armies), sel('tactic', 'Tactic', ['balanced', 'aggressive', 'defensive'])], build: v => (v.armyId ? { params: { armyId: v.armyId, tactic: v.tactic } } : { error: 'no army' }) },
  declareWar: { group: 'War', title: 'Declare war', help: 'Goals are judged against your best CB: overreach costs Reputational Leverage with each observer, scaled by its closeness to the victim.',
    fields: o => [sel('target', 'Target', o.countries), { name: 'goals', label: 'War goals', type: 'multi', options: opts(['tribute', 'cede', 'dependency', 'annex']) }], build: v => ({ params: { target: v.target, goals: (v.goals ?? []).map(type => ({ type })) } }) },
  proposePeace: { group: 'War', title: 'Propose peace (Peace Conference)', help: 'Terms: cede the selected province, secession (internal wars), Rights/Duties concessions (JSON list of {kind,id,scope,value}), treaty terms (JSON list).',
    fields: o => [sel('war', 'War', o.wars), { name: 'cede', label: 'Cede selected province to the proposer', type: 'check', default: false }, { name: 'secede', label: 'Grant secession (internal war)', type: 'check', default: false }, { name: 'concessions', label: 'Concessions (JSON)', type: 'json', default: '' }, { name: 'treaties', label: 'Treaty terms (JSON)', type: 'json', default: '' }],
    build: (v, o) => { const c = parseJson(v.concessions, []), t = parseJson(v.treaties, []); if (c.error || t.error) return { error: c.error ?? t.error }
      const terms = { cede: v.cede && o.selectedProvince ? [{ province: o.selectedProvince, from: o.provinceOwner, to: o.me }] : [] }; if (v.secede) terms.secede = true; if (c.value.length) terms.concessions = c.value; if (t.value.length) terms.treaties = t.value
      return v.war ? { params: { war: v.war, terms } } : { error: 'no active war' } } },
  proposeTreaty: { group: 'Diplomacy', title: 'Propose a treaty', help: 'Ratified by the counterpart Government and any cells holding the treaty Veto.',
    fields: o => [sel('to', 'Counterpart', o.counterparts), sel('kind', 'Kind', ['Alliance', 'Dependency', 'Confederation', 'Cooperation']), sel('tier', 'Alliance tier', ['Guarantee', 'BenevolentNeutrality', 'Defensive', 'Coalition', 'StandingOffensive']), sel('overlord', 'Overlord (Dependency)', [opt('me', 'me'), opt('them', 'counterpart')]), AXES(o), TERMS, { name: 'cooperation', label: 'Cooperation fields (comma list)', type: 'text', default: 'Trade' }],
    build: (v, o) => { const a = axesFrom(v.axes, v.terms); if (a.error) return a; const p = { to: v.to, kind: v.kind, axes: a.axes }
      if (v.kind === 'Alliance') { p.tier = v.tier; if (v.tier === 'Guarantee') p.guarantor = o.me }; if (v.kind === 'Dependency') p.overlord = v.overlord === 'me' ? o.me : v.to
      if (v.kind === 'Cooperation') p.cooperation = String(v.cooperation).split(',').map(s => s.trim()).filter(Boolean); return { params: p } } },
  answerProposal: { group: 'Diplomacy', title: 'Answer a proposal', fields: o => [sel('id', 'Incoming proposal', o.proposals), { name: 'accept', label: 'Accept', type: 'check', default: true }], build: v => (v.id ? { params: { id: v.id, accept: !!v.accept } } : { error: 'no pending proposal' }) },
  imposeSanction: { group: 'Diplomacy', title: 'Impose a Sanction', help: 'Ad hoc sanctions give the target a Grievance CB unless great-power-backed.', fields: o => [sel('target', 'Target', o.countries), AXES(o), TERMS, { name: 'stripsCB', label: 'Strip external recognition of the target\'s CBs', type: 'check', default: false }],
    build: v => { const a = axesFrom(v.axes, v.terms); if (a.error) return a; return a.axes.length ? { params: { target: v.target, axes: a.axes, stripsCB: !!v.stripsCB } } : { error: 'choose at least one axis' } } },
  denounceTreaty: { group: 'Diplomacy', title: 'Denounce a treaty', help: 'Breaking a promise costs Reputational Leverage and hands the wronged party a CB (lifting your own Sanction is free).', fields: o => [sel('id', 'Treaty', o.treaties)], build: v => (v.id ? { params: { id: v.id } } : { error: 'no treaty' }) },
  recognizeBloc: { group: 'Diplomacy', title: 'Recognise a rebel bloc', help: 'Backing a secession bid is CB-generating against the parent Country.', fields: o => [sel('bloc', 'Bloc', o.blocs)], build: v => (v.bloc ? { params: { bloc: v.bloc } } : { error: 'no active bloc' }) },
  grantFacilitation: { group: 'Diplomacy', title: 'Facilitation Grant', help: 'A real transfer of goods from one of your provinces to the grantee.', fields: o => [sel('to', 'Grantee', o.granteeIds), { name: 'from', label: 'From province', type: 'text', default: o.selectedProvince ?? '' }, sel('good', 'Good', o.goods), num('qty', 'Quantity', 10, { min: 1 })],
    build: v => ({ params: { to: v.to, from: v.from, good: v.good, qty: +v.qty } }) },
}
export const FORM_GROUPS = ['Government', 'Apparatus', 'War', 'Diplomacy']
export const formsIn = group => Object.entries(FORMS).filter(([, f]) => f.group === group).map(([id, f]) => ({ id, title: f.title }))
/** Build the order for a form. Returns { order } or { error }. */
export function buildOrder(type, values, o) {
  const f = FORMS[type]; if (!f) return { error: `no form for ${type}` }
  if (f.scoped && o.scopeError) return { error: o.scopeError }
  const r = f.build(values, o); return r.error ? { error: r.error } : { order: { actor: { kind: 'government', country: o.me }, type, params: r.params } } }
export const defaults = (type, o) => Object.fromEntries((FORMS[type]?.fields(o) ?? []).map(f => [f.name, f.default ?? (f.type === 'multi' ? [] : f.type === 'check' ? false : '')]))
export const describeOrder = order => `${order.type}${order.params ? ' ' + JSON.stringify(order.params).slice(0, 90) : ''}`
