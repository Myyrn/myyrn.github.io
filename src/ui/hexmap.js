// ui/hexmap.js — shared hex geometry + drawing helpers (game debug shell and Editor use the SAME renderer so what you paint is what you play).
export const TERRAIN = { Mountain: '#8d8d8d', Hill: '#b59b6a', Desert: '#e3cf8f', Steppe: '#c9c27a', Grassland: '#8fbf6a', Wetland: '#6fa88f', Jungle: '#3f8f4f', Arctic: '#e8f0f4', Taiga: '#5f7f5f' }
export const SURFACE = { sea: '#3a6ea5', lake: '#6fa8dc' }
export function geometry(grid, s = 22) { const w = Math.sqrt(3) * s; return { s, w, W: Math.ceil(w * (grid.w + 0.5)) + 4, H: Math.ceil(s * (1.5 * grid.h + 0.5)) + 4, ctr: (x, y) => [w * (x + 0.5 * (y & 1)) + w / 2 + 2, s * 1.5 * y + s + 2] } }
export function hexPath(ctx, cx, cy, s) { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 180 * (60 * i - 30); ctx.lineTo(cx + s * Math.cos(a), cy + s * Math.sin(a)) } ctx.closePath() }
export function pickHex(canvas, event, grid, hexes) { const r = canvas.getBoundingClientRect(), g = geometry(grid), mx = (event.clientX - r.left) * canvas.width / r.width, my = (event.clientY - r.top) * canvas.height / r.height; let best = null, bd = 1e9
  for (const h of Object.values(hexes)) { const [cx, cy] = g.ctr(h.x, h.y), d = (cx - mx) ** 2 + (cy - my) ** 2; if (d < bd) { bd = d; best = h } } return best }
export function drawEdges(ctx, g, edges) { for (const e of edges) { const A = e.a.slice(2).split(',').map(Number), B = e.b.slice(2).split(',').map(Number), [ax, ay] = g.ctr(...A), [bx, by] = g.ctr(...B)
  ctx.strokeStyle = e.type === 'river' ? '#1d5fa8' : e.type === 'sea_lane' ? '#6ec1e4' : '#222'; ctx.lineWidth = 3; ctx.setLineDash(e.type === 'mountain_pass' ? [4, 3] : e.type === 'sea_lane' ? [2, 5] : []); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([])
  if (e.fortress) { ctx.fillStyle = '#000'; ctx.fillRect((ax + bx) / 2 - 3, (ay + by) / 2 - 3, 6, 6) } } }
