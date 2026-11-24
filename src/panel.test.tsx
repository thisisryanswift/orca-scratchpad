// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import type { ScratchState } from './protocol'
import * as panel from './panel'
import { apply, parse, type Op } from './scratch'

function fakeWorker(initial: string) {
  let text = initial
  const answer = (): ScratchState => ({
    status: 'ok',
    workspaceId: 'w1',
    workspaceName: 'ask',
    host: 'devbox',
    file: '/tmp/scratch/devbox/dev--ask.md',
    rel: 'devbox/dev--ask.md',
    ...parse(text)
  })
  return {
    get text() {
      return text
    },
    set text(next: string) {
      text = next
    },
    host: mockHost({
      requests: {
        'scratch.open': () => answer(),
        'scratch.edit': ({ op }: { op: Op }) => {
          text = apply(text, op)
          return answer()
        }
      }
    })
  }
}

test('adds, ticks and clears items', async () => {
  const fake = fakeWorker('- [ ] write the plugin\n')
  const view = await mount(panel, { host: fake.host })
  assert.ok(view.find({ label: 'write the plugin' }))

  await view.type({ label: 'Add an item' }, 'ship it', { submit: true })
  assert.equal(fake.text, '- [ ] write the plugin\n- [ ] ship it\n')
  assert.equal(view.valueOf({ label: 'Add an item' }), '')

  await view.toggle({ label: 'write the plugin' })
  assert.equal(fake.text, '- [x] write the plugin\n- [ ] ship it\n')

  await view.press({ text: 'Clear done' })
  assert.equal(fake.text, '- [ ] ship it\n')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.warnings, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('edits an item in place and reloads when an agent changes the file', async () => {
  const fake = fakeWorker('- [ ] typo hre\n')
  const view = await mount(panel, { host: fake.host })
  await view.press({ label: 'Edit typo hre' })
  await view.type({ label: 'Edit item' }, 'typo here', { replace: true, submit: true })
  assert.equal(fake.text, '- [ ] typo here\n')

  fake.text = '- [ ] typo here\n- [ ] added by an agent\n'
  await view.post('scratch.changed', { dir: '/tmp/scratch/devbox' })
  assert.ok(view.find({ label: 'added by an agent' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('hides the old list while switching workspaces, so nothing lands in it', async () => {
  let release: () => void = () => {}
  let calls = 0
  const host = mockHost({
    capabilities: ['workspace:read'],
    requests: {
      'scratch.open': async ({ workspaceId }: { workspaceId?: string }) => {
        calls += 1
        if (workspaceId === 'w2') await new Promise<void>((resolve) => (release = resolve))
        return {
          status: 'ok', workspaceId: workspaceId ?? 'w1', workspaceName: workspaceId ?? 'w1', host: 'devbox',
          file: `/tmp/${workspaceId}.md`, rel: `devbox/${workspaceId}.md`, items: [], notes: ''
        }
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.find({ label: 'Add an item' }))
  const switching = view.emit('workspace.changed', {
    context: { workspaceId: 'w2', branch: '', displayName: 'w2', terminals: [] }
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(view.find({ label: 'Add an item' }), null)
  release()
  await switching
  await view.settled()
  assert.ok(view.summary().some((line) => line.includes('w2')), view.summary().join(' | '))
  assert.ok(calls >= 2)
  await view.unmount()
})

test('follows a switch whose event carries no workspace id (paired-server workspaces)', async () => {
  let focusedNow = 'homelab'
  const host = mockHost({
    capabilities: ['workspace:read'],
    requests: {
      // Stands in for the worker reading workspace.readContext when no id is passed.
      'scratch.open': ({ workspaceId }: { workspaceId?: string }) => {
        const name = workspaceId ?? focusedNow
        return {
          status: 'ok', workspaceId: name, workspaceName: name, host: 'devbox',
          file: `/tmp/${name}.md`, rel: `devbox/${name}.md`, items: [], notes: ''
        }
      }
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.summary().some((line) => line.includes('homelab')), view.summary().join(' | '))
  focusedNow = 'ask'
  await view.emit('workspace.changed', { context: { branch: '', displayName: 'ask', terminals: [] } })
  await view.settled()
  assert.ok(view.summary().some((line) => line.includes('ask')), view.summary().join(' | '))
  await view.unmount()
})

test('asks for the host name of a remote workspace', async () => {
  const host = mockHost({
    requests: {
      'scratch.open': () => ({ status: 'needs-host', workspaceId: 'w1', workspaceName: 'ask', hostId: 'runtime:abc' }),
      'scratch.nameHost': ({ name }: { name: string }) => ({
        status: 'ok', workspaceId: 'w1', workspaceName: 'ask', host: name,
        file: `/tmp/${name}/dev--ask.md`, rel: `${name}/dev--ask.md`, items: [], notes: ''
      })
    }
  })
  const view = await mount(panel, { host })
  assert.ok(view.summary().some((line) => line.includes('Which server is this?')), view.summary().join(' | '))
  await view.type({ label: 'Host name' }, 'devbox', { submit: true })
  assert.ok(view.summary().some((line) => line.includes('Nothing here yet')), view.summary().join(' | '))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})
