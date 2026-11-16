import type { LabelContext } from './types.js'

/** Tokens never run code: a path and a short list of known formatters, parsed by hand, no eval. */
export const MAX_PATH_SEGMENTS = 4
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/
const TOKEN = /\{\{([^{}]*)\}\}/g
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type TokenIssue = { token: string; kind: 'missing' | 'invalid-token' }
export type Resolved = { text: string; issues: TokenIssue[] }

type Arg = string | number

/** Split `a | fmt:"x":2` on pipes and colons outside double quotes. */
function split(s: string, sep: string): string[] | null {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (const ch of s) {
    if (ch === '"') quoted = !quoted
    if (ch === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (quoted) return null
  out.push(cur)
  return out
}

function parseArg(raw: string): Arg | null {
  const t = raw.trim()
  if (/^"[^"]*"$/.test(t)) return t.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return null
}

function lookup(path: string, data: unknown, context: LabelContext): unknown {
  const parts = path.split('.')
  let cur: unknown = parts[0]! in context ? context : data
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const empty = (v: unknown): boolean => v === undefined || v === null || v === ''

function date(v: unknown, fmt: string): string | null {
  const d = v instanceof Date ? v : typeof v === 'string' || typeof v === 'number' ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const map: Record<string, string> = {
    YYYY: String(d.getUTCFullYear()),
    MMM: MONTHS[d.getUTCMonth()]!,
    MM: pad(d.getUTCMonth() + 1),
    DD: pad(d.getUTCDate()),
    D: String(d.getUTCDate()),
  }
  return fmt.replace(/YYYY|MMM|MM|DD|D/g, (m) => map[m]!)
}

function format(value: unknown, name: string, args: Arg[]): string | null {
  const str = String(value ?? '')
  switch (name) {
    case 'upper': return str.toUpperCase()
    case 'lower': return str.toLowerCase()
    case 'default': return empty(value) ? String(args[0] ?? '') : str
    case 'date': return date(value, String(args[0] ?? 'YYYY-MM-DD'))
    case 'money': {
      const n = Number(value)
      return Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null
    }
    case 'slice': return str.slice(Number(args[0] ?? 0), args[1] === undefined ? undefined : Number(args[1]))
    default: return null
  }
}

export function resolveToken(body: string, data: unknown, context: LabelContext = {}): { text: string; issue?: TokenIssue['kind'] } {
  const pipes = split(body, '|')
  if (!pipes) return { text: '', issue: 'invalid-token' }
  const path = pipes[0]!.trim()
  if (!PATH.test(path) || path.split('.').length > MAX_PATH_SEGMENTS) return { text: '', issue: 'invalid-token' }
  const steps: Array<[string, Arg[]]> = []
  for (const raw of pipes.slice(1)) {
    const bits = split(raw.trim(), ':')
    const name = bits?.[0]?.trim()
    if (!bits || !name || !/^[a-z]+$/.test(name)) return { text: '', issue: 'invalid-token' }
    const args = bits.slice(1).map(parseArg)
    if (args.some((a) => a === null)) return { text: '', issue: 'invalid-token' }
    steps.push([name, args as Arg[]])
  }
  let value = lookup(path, data, context)
  const fallback = steps.some(([n]) => n === 'default')
  if (empty(value) && !fallback) return { text: '', issue: 'missing' }
  let text = String(value ?? '')
  for (const [name, args] of steps) {
    const out = format(value, name, args)
    if (out === null) return { text: '', issue: 'invalid-token' }
    value = out
    text = out
  }
  return { text }
}

/** Replace every `{{token}}` in `template`. A missing or invalid token becomes empty and is reported. */
export function resolveTokens(template: string, data: unknown, context: LabelContext = {}): Resolved {
  const issues: TokenIssue[] = []
  const text = template.replace(TOKEN, (_all, body: string) => {
    const r = resolveToken(body, data, context)
    if (r.issue) issues.push({ token: body.trim(), kind: r.issue })
    return r.text
  })
  return { text, issues }
}
