// ui/views/dock.js — DockedDetailPanel: the one place object cards live (province, actor cell, country, army). Persistent selection, never a modal.
import { h, card, kv, bar, badge, radar, fmt, rawView, tierTone } from '../dom.js'
import { select, openDraft, renderAll } from '../app.js'
const NEEDS = ['subsistence', 'comfort', 'luxury', 'identity_autonomy', 'solidarity', 'purpose_meaning', 'faith_cosmology', 'security', 'excellence', 'superiority', 'pleasure', 'fairness']
export async function dockContent(app, sel) {
  if (!sel) return card('Details', h('p', { class: 'muted' }, 'Select a province on the Map, a row in Estates, or a Country in World to see its card here.'))
  const dbg = app.ui.debug
  if (sel.kind === 'province') { const c = await app.q('provinceCard', { id: sel.id })
    return card(`Province ${c.id}`, kv({ Terrain: `${c.terrain} · forest ${c.forestation}%`, Habitability: c.habitability, Water: c.waterSource, Region: c.region, Population: c.population, Owner: c.owner, Controller: c.controller, Roads: c.infrastructure, Commerce: c.tradeInfrastructure }),
      h('h4', null, 'Stock'), h('div', { class: 'chips' }, Object.entries(c.stock).map(([g, v]) => h('span', { class: 'chip' }, `${g} ${v}`))), h('h4', null, 'Nation presence'), h('div', { class: 'chips' }, Object.entries(c.presence).map(([n, v]) => h('span', { class: 'chip' }, `${n} ${v}`))),
      h('h4', null, 'Cells in this Region'), h('div', { class: 'col' }, c.cells.map(k => h('a', { class: 'link', onclick: () => select('cell', k) }, k))),
      c.armies.length ? [h('h4', null, 'Armies here'), c.armies.map(id => h('a', { class: 'link', onclick: () => select('army', id) }, id))] : null,
      h('div', { class: 'row' }, h('button', { onclick: () => openDraft('fieldUnits') }, 'Field army here'), h('button', { onclick: () => openDraft('orderMove') }, 'Move army here'), h('button', { onclick: () => openDraft('grantFacilitation') }, 'Grant from here')), rawView(c, dbg)) }
  if (sel.kind === 'cell') { const c = await app.q('cellCard', { key: sel.id }), [nation, estate, region] = sel.id.split('|')
    return card(`Cell ${c.key}`, kv({ Population: c.population, Wealth: c.wealth, Prestige: c.prestige, Weight: c.weight, Awareness: c.awareness, 'Control grant': c.controlGrant }),
      h('h4', null, 'Needs (satisfaction · grievance)'), h('table', { class: 'grid mini' }, NEEDS.filter(n => c.satisfaction[n] !== undefined || c.grievance[n] !== undefined).map(n => h('tr', null, h('td', null, n), h('td', null, c.satisfaction[n] !== undefined ? bar(c.satisfaction[n], { tone: 'ok' }) : '—'), h('td', null, bar(c.grievance[n] ?? 0, { tone: 'bad' }))))),
      h('h4', null, 'Opinion of Government'), bar(c.opinion, { min: -1, max: 1, signed: true, tone: c.opinion < 0 ? 'bad' : 'ok' }),
      h('h4', null, 'Compliance'), kv({ voluntary: bar(c.compliance.voluntary), involuntary: bar(c.compliance.involuntary), total: bar(c.compliance.total) }),
      c.escalation.length ? [h('h4', null, 'Escalation'), c.escalation.map(e => badge(`${e.need}: rung ${e.rung}`, e.rung >= 3 ? 'bad' : 'warn'))] : null,
      h('h4', null, 'Preference (Portrait axes)'), radar(c.pref),
      h('h4', null, 'Control allocation here'), c.controlFilters.length ? h('table', { class: 'grid mini' }, c.controlFilters.map(f => h('tr', null, h('td', null, `filter ${f.entry}`), h('td', { class: 'num' }, `floor ${f.floor}`), h('td', { class: 'num' }, `prio ${f.priority}`), h('td', { class: 'num' }, `grant ${fmt(f.grant)}`)))) : h('p', { class: 'muted' }, 'No filter reaches this cell.'),
      h('h4', null, 'Rights & Duties in force'), h('div', { class: 'chips' }, [...c.rights.map(([id, v]) => h('span', { class: 'chip' }, `${id}${v === true ? '' : '=' + JSON.stringify(v)}`)), ...c.duties.map(([id, v]) => h('span', { class: 'chip duty' }, `${id} ${JSON.stringify(v)}`))]),
      c.flags && Object.keys(c.flags).length ? h('p', { class: 'muted' }, 'flags: ' + JSON.stringify(c.flags)) : null,
      h('div', { class: 'row' }, h('button', { onclick: async () => { app.ui.filter = { nation, estate, region }; await renderAll() } }, 'Scope to this cell'), h('button', { onclick: () => { app.ui.filter = { nation, estate, region }; openDraft('reformRightsDuties') } }, 'Reform for this cell')), rawView(c, dbg)) }
  if (sel.kind === 'country') { const p = await app.q('pair', { a: app.me(), b: sel.id }), name = app.pkg.countries.countries[sel.id]?.name ?? sel.id
    return card(name, kv({ 'Reputation (you of them)': bar(p.reputation.aOfB, { min: -3, max: 3, signed: true }), 'Reputation (them of you)': bar(p.reputation.bOfA, { min: -3, max: 3, signed: true }), Economic: p.leverage.economic, Diplomatic: p.leverage.diplomatic, Military: p.leverage.military, Cultural: p.leverage.cultural }),
      h('h4', null, 'CBs you hold'), p.cbs.aAgainstB.length ? p.cbs.aAgainstB.map(c => h('div', null, badge(c.tier, tierTone(c.tier)), ` ${c.reason} · ${c.class}${c.recognised === false ? ' · not externally recognised' : ''}`)) : h('p', { class: 'muted' }, 'none'),
      h('h4', null, 'CBs they hold'), p.cbs.bAgainstA.length ? p.cbs.bAgainstA.map(c => h('div', null, badge(c.tier, tierTone(c.tier)), ` ${c.reason} · ${c.class}`)) : h('p', { class: 'muted' }, 'none'),
      h('h4', null, 'Treaties'), p.treaties.length ? p.treaties.map(t => h('div', null, badge(t.kind), ` ${t.tier ?? ''} ${t.id}`)) : h('p', { class: 'muted' }, 'none'),
      h('div', { class: 'row' }, h('button', { onclick: () => openDraft('proposeTreaty', { to: sel.id }) }, 'Propose treaty'), h('button', { onclick: () => openDraft('imposeSanction', { target: sel.id }) }, 'Sanction'), h('button', { onclick: () => openDraft('declareWar', { target: sel.id }) }, 'Declare war')), rawView(p, dbg)) }
  if (sel.kind === 'army') { const m = await app.q('military', { country: app.me() }), a = m.armies.find(x => x.id === sel.id)
    return card(`Army ${sel.id}`, a ? [kv({ Owner: a.owner, Position: a.position, Destination: a.destination ?? '—', Men: a.men, Cohesion: bar(a.cohesion), Supply: bar(a.supply), Tactic: a.tactic }), h('div', { class: 'chips' }, Object.entries(a.composition).map(([p, n]) => h('span', { class: 'chip' }, `${p} ${n}`))),
      a.owner === app.me() ? h('div', { class: 'row' }, h('button', { onclick: () => openDraft('orderMove', { armyId: a.id }) }, 'Order move'), h('button', { onclick: () => openDraft('setTactic', { armyId: a.id }) }, 'Tactic')) : null, rawView(a, dbg)] : h('p', { class: 'muted' }, 'gone')) }
  return card('Details', h('p', { class: 'muted' }, 'nothing selected')) }
