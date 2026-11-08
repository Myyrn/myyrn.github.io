// worldmap/hex.js — pointy-top, odd-r offset hex grid. Side index: 0=E 1=NE 2=NW 3=W 4=SW 5=SE.
export const ODDR = [
  [[+1, 0], [0, -1], [-1, -1], [-1, 0], [-1, +1], [0, +1]],     // even rows
  [[+1, 0], [+1, -1], [0, -1], [-1, 0], [0, +1], [+1, +1]],     // odd rows
]
export const hexId = (x, y) => `h:${x},${y}`
export const provId = (x, y) => `p:${x},${y}`
export const parseId = id => { const [x, y] = id.slice(2).split(',').map(Number); return { x, y } }
export const inGrid = (x, y, w, h) => x >= 0 && y >= 0 && x < w && y < h

/** neighbours with side index, clipped to the grid */
export function neighbors(x, y, w, h) {
  return ODDR[y & 1].map(([dx, dy], side) => ({ x: x + dx, y: y + dy, side })).filter(n => inGrid(n.x, n.y, w, h))
}
export const sideTo = (a, b, w, h) => neighbors(a.x, a.y, w, h).find(n => n.x === b.x && n.y === b.y)?.side ?? -1
const toCube = ({ x, y }) => { const q = x - (y - (y & 1)) / 2; return { q, r: y, s: -q - y } }
export function distance(a, b) { const A = toCube(a), B = toCube(b); return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.s - B.s)) }
export const edgeKey = (aId, bId) => (aId < bId ? `${aId}~${bId}` : `${bId}~${aId}`)

/** Movement rule (confirmed): an edge between two Mountain hexes is blocked unless it is a mountain_pass.
 *  edges: Record<edgeKey, {type,...}>; terrainOf(provId) -> terrain name */
export function edgePassable(aProv, bProv, edges, terrainOf) {
  if (terrainOf(aProv) === 'Mountain' && terrainOf(bProv) === 'Mountain') return edges[edgeKey(aProv, bProv)]?.type === 'mountain_pass'
  return true
}
