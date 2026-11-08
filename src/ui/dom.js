// ui/dom.js — tiny DOM helpers + widgets. Views hold no game data (UI Rule 4): everything drawn comes from a client query.
const NS = 'http://www.w3.org/2000/svg'
export function h(tag, props, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props ?? {})) { if (v == null || v === false) continue
    if (k === 'class') el.className = v; else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v); else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v)
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v; else el.setAttribute(k, v === true ? '' : v) }
  for (const kid of kids.flat(Infinity)) { if (kid == null || kid === false) continue; el.append(kid.nodeType ? kid : document.createTextNode(String(kid))) }
  return el }
export function svg(tag, props, ...kids) {
  const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(props ?? {})) if (v != null) el.setAttribute(k, v)
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)))
  return el }
export const fmt = (x, d = 2) => (typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(d)) : x == null ? '—' : String(x))
export const short = (v, n = 70) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n - 1) + '…' : s }
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

/** Bullet bar: value in [min,max] filled from the left (or centred for signed ranges); optional marker. */
export function bar(value, { min = 0, max = 1, tone = 'accent', title, signed = false } = {}) {
  const v = clamp((value - min) / ((max - min) || 1), 0, 1), fill = signed ? { left: `${Math.min(v, 0.5) * 100}%`, width: `${Math.abs(v - 0.5) * 100}%` } : { left: '0', width: `${v * 100}%` }
  return h('span', { class: `bar ${signed ? 'signed' : ''}`, title: title ?? fmt(value) }, h('i', { class: `fill ${tone}`, style: fill }), signed ? h('b', { class: 'zero' }) : null) }
export const badge = (text, tone = 'muted') => h('span', { class: `badge ${tone}` }, text)
export const tierTone = t => ({ existential: 'bad', structural: 'warn', routine: 'muted', Grievance: 'muted', Rights: 'warn', Sovereignty: 'bad', Existential: 'bad' })[t] ?? 'muted'

/** Sortable table: columns [{key,label,render?(row),num?,sort?(row)}]; rows are plain objects; onRow(row) makes rows selectable. */
export function table(columns, rows, { onRow, selected, sortKey, empty = 'nothing to show', max } = {}) {
  let key = sortKey ?? null, dir = -1; const body = h('tbody'), head = h('tr')
  const draw = () => { body.replaceChildren()
    let rs = [...rows]; if (key) { const c = columns.find(c => c.key === key), f = c?.sort ?? (r => r[key]); rs.sort((a, b) => { const x = f(a), y = f(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir }) }
    if (max) rs = rs.slice(0, max)
    if (!rs.length) body.append(h('tr', null, h('td', { colspan: columns.length, class: 'muted' }, empty)))
    for (const r of rs) body.append(h('tr', { class: `${onRow ? 'click' : ''} ${selected && selected(r) ? 'sel' : ''}`, onclick: onRow ? () => onRow(r) : null }, columns.map(c => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : fmt(r[c.key]))))) }
  for (const c of columns) head.append(h('th', { class: c.num ? 'num' : '', onclick: () => { dir = key === c.key ? -dir : -1; key = c.key; draw() } }, c.label))
  draw(); return h('table', { class: 'grid' }, h('thead', null, head), body) }
export const tabs = (names, active, onChange) => h('div', { class: 'tabs' }, names.map(n => h('button', { class: n === active ? 'tab on' : 'tab', onclick: () => onChange(n) }, n)))
export const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h3', null, title) : null, kids)
export const kv = obj => h('dl', { class: 'kv' }, Object.entries(obj).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v?.nodeType ? v : fmt(v))]))
export const rawView = (obj, on) => (on ? h('details', { class: 'raw' }, h('summary', null, 'View raw'), h('pre', null, JSON.stringify(obj, null, 1))) : null)
/** Radar of Portrait-axis Preference vector (values in [-1, 1]). */
export function radar(vec, size = 150) {
  const axes = Object.keys(vec), n = axes.length, c = size / 2, R = size / 2 - 22, pt = (i, v) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n, r = R * (0.5 + 0.5 * clamp(v, -1, 1)); return [c + r * Math.cos(a), c + r * Math.sin(a)] }
  const poly = axes.map((a, i) => pt(i, vec[a]).join(',')).join(' '), ring = k => axes.map((a, i) => pt(i, k).join(',')).join(' ')
  return svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'radar' }, svg('polygon', { points: ring(1), class: 'ring' }), svg('polygon', { points: ring(0), class: 'ring mid' }), svg('polygon', { points: poly, class: 'shape' }),
    axes.map((a, i) => { const [x, y] = pt(i, 1.25); return svg('text', { x, y, 'text-anchor': 'middle', 'font-size': 7, class: 'axlabel' }, a.split('_')[0].slice(0, 7)) })) }
export const hue = s => { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) % 360; return `hsl(${x} 55% 55%)` }
export function ramp(t) { const a = [70, 150, 90], b = [205, 70, 45], m = a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t, 0, 1))); return `rgb(${m})` }
