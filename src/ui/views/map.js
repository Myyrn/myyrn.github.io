// ui/views/map.js — Map workspace: lens map (native resolution; Region-resolution values spread over the Region's provinces, never smoothed), Table and Detail modes, scope treemap.
import { h, card, tabs, table, fmt, bar, ramp, hue, badge } from '../dom.js'
import { TERRAIN, SURFACE, geometry as geom, hexPath, pickHex, drawEdges } from '../hexmap.js'
import { select, renderAll } from '../app.js'
import { SLICE_ORDERS } from '../scope.js'
export const LENSES = { Terrain: 'terrain', Owner: 'owner', Population: 'population', Subsistence: 'subsistence', Unrest: 'unrest', Grievance: 'grievance', Goods: 'goods', Roads: 'roads', Commerce: 'commerce', Claims: 'claims', Military: 'military', Cultural: 'cultural' }
export async function render(app) {
  const u = app.ui, map = await app.q('map'), lensKey = u.lens, lens = lensKey === 'terrain' || lensKey === 'owner' ? null : await app.q('lens', { lens: lensKey, param: u.lensParam })
  const rules = app.rules, mil = await app.q('military', { country: app.me() }), tree = await app.q('scopeTree', { country: app.me(), order: SLICE_ORDERS[u.sliceOrder] })
  const lensSel = h('select', { id: 'lens', onchange: async e => { u.lens = e.target.value; u.lensParam = u.lens === 'goods' ? 'Grain' : u.lens === 'grievance' ? 'subsistence' : null; await renderAll() } }, Object.entries(LENSES).map(([l, k]) => h('option', { value: k, selected: k === lensKey }, l)))
  const paramSel = lensKey === 'goods' || lensKey === 'grievance' ? h('select', { id: 'lensparam', onchange: async e => { u.lensParam = e.target.value; await renderAll() } }, (lensKey === 'goods' ? rules.goods : rules.needs).map(g => h('option', { value: g, selected: g === u.lensParam }, g))) : null
  const cv = h('canvas', { id: 'map' }), g = geom(map.grid); cv.width = g.W; cv.height = g.H
  const ctx = cv.getContext('2d'), nationColor = n => hue(n)
  for (const hx of Object.values(map.hexes)) { const [cx, cy] = g.ctr(hx.x, hx.y), id = `p:${hx.x},${hx.y}`, p = map.provinces[id]; let col
    if (hx.surface !== 'land') col = SURFACE[hx.surface]
    else if (lensKey === 'terrain') col = TERRAIN[p.terrain]
    else if (lensKey === 'owner') col = map.countries[p.owner]?.color ?? '#999'
    else if (lensKey === 'cultural') col = lens.values[id] ? nationColor(lens.values[id]) : '#777'
    else col = ramp((lens.values[id] ?? 0) / lens.max)
    hexPath(ctx, cx, cy, g.s); ctx.fillStyle = col; ctx.fill(); const sel = u.selected?.kind === 'province' && u.selected.id === id; ctx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.25)'; ctx.lineWidth = sel ? 3 : 1; ctx.stroke() }
  for (const a of mil.armies) { const [x, y] = a.position.slice(2).split(',').map(Number), [cx, cy] = g.ctr(x, y); ctx.beginPath(); ctx.arc(cx, cy, 7, 0, 7); ctx.fillStyle = map.countries[a.owner]?.color ?? '#555'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke() }
  drawEdges(ctx, g, Object.values(map.edges))
  cv.onclick = async e => { const best = pickHex(cv, e, map.grid, map.hexes); if (best && map.provinces[`p:${best.x},${best.y}`]) await select('province', `p:${best.x},${best.y}`).then(async () => { await renderAll() }) }
  const legend = h('div', { class: 'legend' }, lens && lens.max > 0 && lensKey !== 'cultural' ? [h('span', null, '0'), h('i', { class: 'grad' }), h('span', null, fmt(lens.max, 1))] : lensKey === 'owner' ? Object.entries(map.countries).map(([id, c]) => h('span', { class: 'chip', style: { borderColor: c.color } }, c.name)) : lensKey === 'cultural' ? [...new Set(Object.values(lens.values).filter(Boolean))].map(n => h('span', { class: 'chip', style: { borderColor: nationColor(n) } }, n)) : null)
  const modes = tabs(['Map', 'Table', 'Detail'], u.mapMode, async m => { u.mapMode = m; await renderAll() })
  const provRows = Object.entries(map.provinces).map(([id, p]) => ({ id, owner: p.owner, terrain: p.terrain, population: Math.round(p.population), value: lens ? lens.values[id] : null, region: map.regions[id] }))
  const body = u.mapMode === 'Table' ? card('Provinces', table([{ key: 'id', label: 'province' }, { key: 'owner', label: 'owner' }, { key: 'terrain', label: 'terrain' }, { key: 'region', label: 'region' }, { key: 'population', label: 'pop', num: true }, ...(lens ? [{ key: 'value', label: lensKey, num: true, render: r => fmt(r.value, 1) }] : [])], provRows, { sortKey: 'population', onRow: async r => { await select('province', r.id); await renderAll() }, selected: r => u.selected?.id === r.id }))
    : u.mapMode === 'Detail' ? card('Selected province', u.selected?.kind === 'province' ? h('p', null, 'See the docked panel for the full province card.') : h('p', { class: 'muted' }, 'Click a hex first.')) : h('div', { class: 'card', id: 'mapwrap' }, cv)
  return h('div', { class: 'split' }, h('div', null, h('div', { class: 'row toolbar' }, 'Lens', lensSel, paramSel, modes), legend, body), h('div', { class: 'side' }, card(`Scope tree · ${tree.order.join(' › ')}`, treemap(tree.tree, tree.total))))
}
/** Slice-and-dice treemap: area = population; the hottest child (max grievance) is marked at every level. */
function treemap(nodes, total, depth = 0) {
  if (!nodes?.length) return null
  return h('div', { class: `tm d${depth}` }, nodes.map(n => h('div', { class: `tmnode ${n.hottest ? 'hot' : ''}`, title: `${n.key}: ${n.value} · grievance ${n.heat}`, style: { flexGrow: Math.max(1, n.value), background: depth === 0 ? `color-mix(in srgb, ${ramp(Math.min(1, n.heat * 3))} 35%, transparent)` : undefined } }, h('span', { class: 'tmlabel' }, `${n.key} ${n.value}`, n.hottest ? ' 🔥' : ''), treemap(n.children, n.value, depth + 1))))
}
