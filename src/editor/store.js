// editor/store.js — the ONLY writer of package documents. Patches with inverses; undo/redo; mergeKey groups brush strokes; incremental-by-doc validation hook.
import { applyPatches } from './patch.js'
import { validateAll } from '../data/validators/index.js'
export const DOC_NAMES = ['manifest', 'world', 'nations', 'countries', 'polity', 'relations', 'scenario', 'overrides', 'ruleset']
export class EditorStore {
  constructor(docs) { this.docs = structuredClone(docs); this.undoStack = []; this.redoStack = []; this.dirty = false; this.listeners = new Set(); this.issues = validateAll(this.docs); this.batch = null }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit(kind) { for (const l of this.listeners) l(kind, this) }
  revalidate() { this.issues = validateAll(this.docs); this.emit('validated') }
  /** apply a patch list as ONE history entry (merged into the previous entry when the same mergeKey is used consecutively) */
  apply(label, patches, { mergeKey = null, validate = true } = {}) {
    if (!patches.length) return
    const inverse = applyPatches(this.docs, patches), last = this.undoStack[this.undoStack.length - 1]
    if (mergeKey && last && last.mergeKey === mergeKey) { last.patches.push(...patches); last.inverse.unshift(...inverse) } else this.undoStack.push({ label, patches: [...patches], inverse, mergeKey })
    this.redoStack = []; this.dirty = true; if (validate) this.issues = validateAll(this.docs); this.emit('change') }
  transaction(label, fn) { const all = []; const collect = (l, p) => all.push(...p); fn(collect); this.apply(label, all) }
  undo() { const e = this.undoStack.pop(); if (!e) return false; applyPatches(this.docs, e.inverse); this.redoStack.push(e); this.dirty = true; this.issues = validateAll(this.docs); this.emit('change'); return true }
  redo() { const e = this.redoStack.pop(); if (!e) return false; const inverse = applyPatches(this.docs, e.patches); e.inverse = inverse; this.undoStack.push(e); this.dirty = true; this.issues = validateAll(this.docs); this.emit('change'); return true }
  get canUndo() { return this.undoStack.length > 0 } get canRedo() { return this.redoStack.length > 0 }
  get errors() { return this.issues.filter(i => i.severity === 'error') } get warnings() { return this.issues.filter(i => i.severity === 'warn') }
  /** package as plain documents (what gets saved / launched); ruleset is the one shared ruleset */
  snapshot() { return structuredClone(this.docs) }
}
