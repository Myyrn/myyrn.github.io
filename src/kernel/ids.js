// kernel/ids.js — keys. Cells are (Nation, Estate, Region); province is never a polity key.
/** @typedef {string} Id */
/** @typedef {string} CellKey */
export const cellKey = (nation, estate, region) => `${nation}|${estate}|${region}`
export function parseCellKey(k) {
  const [nation, estate, region] = k.split('|')
  return { nation, estate, region }
}
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)   // unordered country pair
