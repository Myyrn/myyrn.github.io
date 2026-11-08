// data/loaders/readPackage.js — works in Node (fs) and the browser (fetch). Injected reader keeps this file environment-free.
export const DOCS = ['manifest', 'world', 'nations', 'countries', 'polity', 'relations', 'scenario']
export async function readPackage(readJson, base) {
  const pkg = {}; for (const d of DOCS) pkg[d] = await readJson(`${base}/${d}.json`)
  try { pkg.overrides = await readJson(`${base}/overrides.json`) } catch { pkg.overrides = {} }
  return pkg }
export async function readRuleset(readJson, url = 'data/ruleset.json') { return readJson(url) }
export function effectiveRuleset(ruleset, overrides = {}) {          // shared ruleset + scenario overrides (deep merge)
  const merge = (a, b) => { if (b === undefined) return a; if (typeof a !== 'object' || typeof b !== 'object' || a === null || Array.isArray(a)) return b
    const o = { ...a }; for (const k of Object.keys(b)) o[k] = merge(a[k], b[k]); return o }
  return merge(ruleset, overrides) }
