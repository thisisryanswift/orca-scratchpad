import { assert, test } from 'orca/testing'
import { cleanHost, slugFor, slugForWorkspace } from './paths'
import { apply, Conflict, parse } from './scratch'

const FILE = '# Notes from the agent\n- [ ] one\n- [x] two\n  - nested stays\n* three\n'

test('parses top-level bullets as items and keeps the rest as notes', () => {
  const { items, notes } = parse(FILE)
  assert.deepEqual(
    items.map((i) => [i.line, i.text, i.done]),
    [
      [1, 'one', false],
      [2, 'two', true],
      [4, 'three', false]
    ]
  )
  assert.equal(notes, '# Notes from the agent\n  - nested stays')
})

test('adds after the last item, or starts a file', () => {
  assert.equal(apply('', { kind: 'add', text: '  hello   world ' }), '- [ ] hello world\n')
  assert.equal(apply(FILE, { kind: 'add', text: 'four' }).split('\n')[5], '- [ ] four')
})

test('toggles, edits, moves and removes by line, keeping other lines', () => {
  let text = apply(FILE, { kind: 'toggle', line: 1, expect: '- [ ] one' })
  assert.equal(text.split('\n')[1], '- [x] one')
  text = apply(text, { kind: 'edit', line: 4, expect: '* three', text: 'THREE' })
  assert.equal(text.split('\n')[4], '- [ ] THREE')
  text = apply(text, { kind: 'move', line: 4, expect: '- [ ] THREE', dir: -1 })
  assert.deepEqual(parse(text).items.map((i) => i.text), ['one', 'THREE', 'two'])
  text = apply(text, { kind: 'clearDone' })
  assert.deepEqual(parse(text).items.map((i) => i.text), ['THREE'])
  assert.ok(text.includes('  - nested stays'))
})

test('refuses an edit when the line changed underneath', () => {
  assert.throws(
    () => apply(FILE, { kind: 'remove', line: 1, expect: '- [ ] old' }),
    (error: unknown) => error instanceof Conflict
  )
})

test('slugs paths the same way the agent helper does', () => {
  assert.equal(slugFor('/home/me/dev/ask'), 'dev--ask')
  assert.equal(slugFor('/Users/me/dev/ask/'), 'dev--ask')
  assert.equal(slugFor('/srv/work tree'), 'srv--work_tree')
  assert.equal(slugFor('/home/me'), '_home')
  assert.equal(cleanHost('devbox.tailnet-name.ts.net'), 'devbox')
})

test('keys folder workspaces (bots) by id, everything else by path', () => {
  assert.equal(slugForWorkspace('folder:f929-8ae2', ''), 'folder-f929-8ae2')
  assert.equal(slugForWorkspace('p1::/home/me/dev/ask', '/home/me/dev/ask'), 'dev--ask')
})
