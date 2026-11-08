// editor/patch.js — JSON-Patch subset (add / replace / remove) on JSON-pointer paths, with inverses. Keys may contain ':' ',' ' '; '/' and '~' are escaped (~1, ~0).
export const esc = s => String(s).replace(/~/g, '~0').replace(/\//g, '~1')
export const ptr = (...parts) => '/' + parts.map(esc).join('/')
const parse = p => p.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
function walk(root, parts) { let cur = root; for (const k of parts) { if (cur === undefined || cur === null) throw new Error('path does not exist'); cur = cur[k] } return cur }
export const getAt = (root, path) => (path === '' ? root : walk(root, parse(path)))
/** apply patches IN PLACE to `root`; returns the inverse patch list (apply it to undo). */
export function applyPatches(root, patches) {
  const inverse = []
  for (const op of patches) {
    const parts = parse(op.path), key = parts.pop(), parent = walk(root, parts), isArr = Array.isArray(parent)
    const at = isArr ? (key === '-' ? parent.length : Number(key)) : key
    if (op.op === 'add') {
      if (isArr) { parent.splice(at, 0, structuredClone(op.value)); inverse.unshift({ op: 'remove', path: ptr(...parts, at) }) }
      else if (key in parent) { inverse.unshift({ op: 'replace', path: op.path, value: structuredClone(parent[key]) }); parent[key] = structuredClone(op.value) }
      else { parent[key] = structuredClone(op.value); inverse.unshift({ op: 'remove', path: op.path }) } }
    else if (op.op === 'replace') { if (!(at in parent) && !isArr) throw new Error(`replace: ${op.path} does not exist`); inverse.unshift({ op: 'replace', path: op.path, value: structuredClone(parent[at]) }); parent[at] = structuredClone(op.value) }
    else if (op.op === 'remove') { const old = structuredClone(parent[at]); if (isArr) { parent.splice(at, 1); inverse.unshift({ op: 'add', path: ptr(...parts, at), value: old }) } else { delete parent[key]; inverse.unshift({ op: 'add', path: op.path, value: old }) } }
    else throw new Error(`unknown op ${op.op}`) }
  return inverse }
