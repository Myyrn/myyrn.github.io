// ui/views/apparatus.js — Apparatus workspace: the three administrative pools (Control / Coordination / Observation), the Allocation Dials, propaganda, requisitions.
import { h, card, kv, bar, table, fmt, badge } from '../dom.js'
import { openDraft, renderAll } from '../app.js'
import { scopeLabel } from '../scope.js'
export async function render(app) {
  const me = app.me(), g = await app.q('govCard', { country: me }), est = await app.q('estates', { country: me })
  const total = g.cco.control + g.cco.coordination + g.cco.observation || 1, ent = (g.controlDial.entries ?? []), granted = est.reduce((s, e) => s, 0)
  const dial = (title, d, kind) => card(title, d.entries?.length ? table([{ key: 'target', label: 'scope', render: r => scopeLabel(r.target?.kind === 'empire' ? { kind: 'empire' } : r.target) }, { key: 'floor', label: 'floor', num: true }, { key: 'priority', label: 'priority', num: true }, { key: 'surplusWeight', label: 'surplus weight', num: true }], d.entries) : h('p', { class: 'muted' }, 'no entries'), kind ? h('div', { class: 'row' }, h('button', { id: 'draft-control', onclick: () => openDraft(kind) }, 'Add / replace an entry for the current Scope')) : null)
  return h('div', null, h('div', { class: 'row toolbar' }),
    card('Administrative pools (CCO)', h('div', { class: 'stack' }, [['Control', g.cco.control, 'ok'], ['Coordination', g.cco.coordination, 'warn'], ['Observation', g.cco.observation, 'muted']].map(([n, v, t]) => h('div', { class: 'row' }, h('span', { class: 'lbl' }, n), bar(v / total, { tone: t }), fmt(v, 0)))),
      kv({ 'Control supply': g.controlSupply, 'Control bonus (Demotion)': g.controlBonus, 'Martial-law cost': g.martialCost, 'Propaganda draw (Coordination)': g.propagandaDraw })),
    dial('Control Allocation Dial', g.controlDial, 'setControlAllocation'), dial('Observation Dial', g.observationDial, null),
    card('Spending', kv({ Ledger: g.ledger, 'Reserve': g.spendingDial.reserve ?? 0, Sink: g.spendingDial.sink ?? 'keep' }), h('div', { class: 'row' }, h('button', { onclick: () => openDraft('setSpendingDial') }, 'Edit reserve'))),
    card('Government propaganda', g.propaganda.length ? table([{ key: 'id', label: 'id' }, { key: 'amount', label: 'Coordination', num: true }, { key: 'ideal', label: 'ideal', render: r => (r.ideal ? JSON.stringify(r.ideal) : 'amalgam') }, { key: 'targets', label: 'targets', render: r => scopeLabel(r.targets?.kind === 'empire' ? { kind: 'empire' } : r.targets) }], g.propaganda) : h('p', { class: 'muted' }, 'No propaganda running.'),
      h('div', { class: 'row' }, h('button', { onclick: () => openDraft('propaganda') }, 'Start propaganda for the current Scope'), h('button', { onclick: () => openDraft('liftPropaganda') }, 'Lift'))))
}
