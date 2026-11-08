// ui/scope.js — the one Scope syntax (cell | (Nation, Region) | (Estate, Region) | estate | nation | region | empire) shared with Rights/Duties/Control/Requisition.
export function scopeOf(f = {}) {
  const { nation, estate, region } = f
  if (nation && estate && region) return { scope: { kind: 'cell', nation, estate, region } }
  if (nation && region) return { scope: { kind: 'nationRegion', nation, region } }
  if (estate && region) return { scope: { kind: 'estateRegion', estate, region } }
  if (nation && estate) return { error: 'Nation + Estate needs a Region too (no (Nation, Estate) scope exists): pick a Region or clear one filter' }
  if (nation) return { scope: { kind: 'nation', nation } }
  if (estate) return { scope: { kind: 'estate', estate } }
  if (region) return { scope: { kind: 'region', region } }
  return { scope: { kind: 'empire' } } }
export const scopeLabel = s => (!s || s.kind === 'empire' ? 'Empire' : [s.nation, s.estate, s.region].filter(Boolean).join(' · '))
export const matchesFilter = (row, f = {}) => (!f.nation || row.nation === f.nation) && (!f.estate || String(row.estate).split('+').includes(f.estate)) && (!f.region || row.region === f.region)
export const SLICE_ORDERS = [['nation', 'estate', 'region'], ['estate', 'nation', 'region'], ['region', 'nation', 'estate'], ['nation', 'region', 'estate'], ['estate', 'region', 'nation'], ['region', 'estate', 'nation']]
