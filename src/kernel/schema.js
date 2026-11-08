// kernel/schema.js — one Field definition feeds loader validation, defaults, Editor forms and docs.
/** @typedef {{type:string,min?:number,max?:number,step?:number,unit?:string,default?:any,doc?:string,values?:string[],
 *   ref?:string,item?:object,fields?:Object<string,object>,status?:'placeholder'|'authored'|'derived',group?:string,
 *   required?:boolean,check?:(v:any,ctx:any)=>string|null}} Field */
const isNum = v => typeof v === 'number' && Number.isFinite(v)

/** refs: Record<refName, Set<string>> ; returns Issue[] = {id,severity,path,message} */
export function validate(field, value, path = '', refs = {}, issues = []) {
  const bad = (id, message, severity = 'error') => issues.push({ id, severity, path, message })
  if (value === undefined) { if (field.required) bad('required', 'missing required value'); return issues }
  switch (field.type) {
    case 'int': case 'float':
      if (!isNum(value) || (field.type === 'int' && !Number.isInteger(value))) return bad('type', `expected ${field.type}`), issues
      if (field.min !== undefined && value < field.min) bad('range', `below min ${field.min}`)
      if (field.max !== undefined && value > field.max) bad('range', `above max ${field.max}`)
      break
    case 'any': break                                   // no type check (use sparingly)
    case 'bool': if (typeof value !== 'boolean') bad('type', 'expected bool'); break
    case 'string': case 'color': if (typeof value !== 'string') bad('type', 'expected string'); break
    case 'enum': if (!field.values.includes(value)) bad('enum', `must be one of ${field.values.join(', ')}`); break
    case 'ref': if (!(refs[field.ref] && refs[field.ref].has(value))) bad('ref', `unknown ${field.ref} id "${value}"`); break
    case 'list':
      if (!Array.isArray(value)) return bad('type', 'expected list'), issues
      value.forEach((v, i) => validate(field.item, v, `${path}/${i}`, refs, issues)); break
    case 'record':
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad('type', 'expected record'), issues
      for (const [k, v] of Object.entries(value)) validate(field.item, v, `${path}/${k}`, refs, issues); break
    case 'object':
      if (typeof value !== 'object' || value === null) return bad('type', 'expected object'), issues
      for (const [k, f] of Object.entries(field.fields)) validate(f, value[k], `${path}/${k}`, refs, issues)
      for (const k of Object.keys(value)) if (!(k in field.fields)) issues.push({ id: 'unknownKey', severity: 'warn', path: `${path}/${k}`, message: `unknown key "${k}"` })
      break
    default: bad('schema', `unknown field type ${field.type}`)
  }
  const msg = field.check?.(value, refs); if (msg) bad('check', msg)
  return issues
}

/** Fill defaults without overwriting authored values. */
export function fillDefaults(field, value) {
  if (field.type === 'object') {
    const out = { ...(value ?? {}) }
    for (const [k, f] of Object.entries(field.fields)) { const v = fillDefaults(f, out[k]); if (v !== undefined) out[k] = v }
    return out
  }
  if (field.type === 'record' && value) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillDefaults(field.item, v)]))
  return value === undefined ? field.default : value
}

/** Numbers-pass worklist: every numeric field still tagged placeholder, with its path. */
export function placeholders(field, value, path = '', out = []) {
  if (field.type === 'object' && value) for (const [k, f] of Object.entries(field.fields)) placeholders(f, value[k], `${path}/${k}`, out)
  else if (field.type === 'record' && value) for (const [k, v] of Object.entries(value)) placeholders(field.item, v, `${path}/${k}`, out)
  else if (field.type === 'list' && value) value.forEach((v, i) => placeholders(field.item, v, `${path}/${i}`, out))
  else if (field.status === 'placeholder' && value !== undefined) out.push(path)
  return out
}
