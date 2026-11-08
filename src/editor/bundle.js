// editor/bundle.js — single-file package bundle (JSON) + IndexedDB persistence (browser). Falls back to an in-memory map under Node (tests).
export const exportBundle = docs => JSON.stringify({ format: 'elental-bundle', version: 1, docs }, null, 1)
export function importBundle(text) { const b = JSON.parse(text); if (b.format !== 'elental-bundle') throw new Error('not an Elental bundle'); return b.docs }
const mem = new Map()
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('elental', 1); r.onupgradeneeded = () => r.result.createObjectStore('packages'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
const tx = async (mode, f) => { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('packages', mode), s = t.objectStore('packages'), q = f(s); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error) }) }
export const hasIdb = () => typeof indexedDB !== 'undefined'
export async function savePackage(name, docs) { if (!hasIdb()) { mem.set(name, structuredClone(docs)); return } await tx('readwrite', s => s.put(docs, name)) }
export async function loadPackage(name) { if (!hasIdb()) return mem.get(name) ? structuredClone(mem.get(name)) : undefined; return tx('readonly', s => s.get(name)) }
export async function listPackages() { if (!hasIdb()) return [...mem.keys()]; return tx('readonly', s => s.getAllKeys()) }
export async function deletePackage(name) { if (!hasIdb()) { mem.delete(name); return } await tx('readwrite', s => s.delete(name)) }
