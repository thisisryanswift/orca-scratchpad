// The list format, as pure functions: parse a Markdown file into items and apply one edit to it.
// Only top-level bullets are items; every other line (headings, notes, nested bullets) is kept as is.

export type Item = {
  /** 0-based line number in the file. */
  line: number
  /** The raw line, used to detect that the file changed under an edit. */
  raw: string
  text: string
  done: boolean
}

export type Op =
  | { kind: 'add'; text: string }
  | { kind: 'toggle'; line: number; expect: string }
  | { kind: 'edit'; line: number; expect: string; text: string }
  | { kind: 'remove'; line: number; expect: string }
  | { kind: 'move'; line: number; expect: string; dir: -1 | 1 }
  | { kind: 'clearDone' }

const ITEM = /^[-*+] (?:\[( |x|X)\] )?(.*)$/

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function parse(text: string): { items: Item[]; notes: string } {
  const items: Item[] = []
  const notes: string[] = []
  splitLines(text).forEach((raw, line) => {
    const m = ITEM.exec(raw)
    if (m) items.push({ line, raw, text: m[2].trim(), done: m[1] === 'x' || m[1] === 'X' })
    else notes.push(raw)
  })
  return { items, notes: notes.join('\n').trim() }
}

export class Conflict extends Error {
  code = 'conflict'
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Applies `op` to the current file text; throws Conflict when the target line moved or changed. */
export function apply(text: string, op: Op): string {
  const lines = splitLines(text)
  const check = (line: number, expect: string) => {
    if (lines[line] !== expect) throw new Conflict('The list changed; reloaded.')
  }
  const items = parse(text).items
  switch (op.kind) {
    case 'add': {
      const t = clean(op.text)
      if (!t) return text
      const last = items[items.length - 1]
      lines.splice(last ? last.line + 1 : lines.length, 0, `- [ ] ${t}`)
      break
    }
    case 'toggle': {
      check(op.line, op.expect)
      const item = items.find((i) => i.line === op.line)
      if (!item) throw new Conflict('Not a list item.')
      lines[op.line] = `- [${item.done ? ' ' : 'x'}] ${item.text}`
      break
    }
    case 'edit': {
      check(op.line, op.expect)
      const item = items.find((i) => i.line === op.line)
      if (!item) throw new Conflict('Not a list item.')
      const t = clean(op.text)
      if (!t) lines.splice(op.line, 1)
      else lines[op.line] = `- [${item.done ? 'x' : ' '}] ${t}`
      break
    }
    case 'remove': {
      check(op.line, op.expect)
      lines.splice(op.line, 1)
      break
    }
    case 'move': {
      check(op.line, op.expect)
      const at = items.findIndex((i) => i.line === op.line)
      const other = items[at + op.dir]
      if (at < 0 || !other) return text
      ;[lines[op.line], lines[other.line]] = [lines[other.line], lines[op.line]]
      break
    }
    case 'clearDone': {
      const doneLines = new Set(items.filter((i) => i.done).map((i) => i.line))
      return join(lines.filter((_, n) => !doneLines.has(n)))
    }
  }
  return join(lines)
}

const join = (lines: string[]) => (lines.length ? lines.join('\n') + '\n' : '')
