// Runs src/worker.ts's activate(orca) over a mock host, against a temporary scratch folder.
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const workspaces = {
  workspaces: [
    { id: 'w-remote', kind: 'folder', name: 'ask', path: '/home/me/dev/ask', branch: null, hostId: 'runtime:abc' },
    { id: 'w-local', kind: 'worktree', name: 'quinoa', path: '/home/me/dev/quinoa', branch: 'main', hostId: 'local' }
  ],
  truncated: false
}

async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'scratch-'))
  const host = mockHost({
    settings: { folder },
    results: {
      'workspace.readContext': { workspaceId: 'w-remote', branch: '', displayName: 'ask', terminals: [] },
      'workspace.list': workspaces
    }
  })
  const worker = await mountWorker(main, { host })
  return { folder, host, worker }
}

test('asks for a remote host name once, then reads and edits that host file', async () => {
  const { folder, host, worker } = await setup()
  const first = await worker.request('scratch.open', {})
  assert.equal(first.status, 'needs-host')

  await mkdir(join(folder, 'devbox'), { recursive: true })
  await writeFile(join(folder, 'devbox', 'dev--ask.md'), '- [ ] from an agent\n')
  const named = await worker.request('scratch.nameHost', {
    workspaceId: 'w-remote',
    hostId: 'runtime:abc',
    name: 'devbox.tailnet-name.ts.net'
  })
  assert.equal(named.status, 'ok')
  assert.deepEqual(host.data().storage, { hosts: { 'runtime:abc': 'devbox' } })
  assert.ok(worker.posts.some((p) => p.event === 'scratch.changed'))
  if (named.status !== 'ok') return
  assert.equal(named.rel, 'devbox/dev--ask.md')
  assert.deepEqual(named.items.map((i) => i.text), ['from an agent'])

  const added = await worker.request('scratch.edit', { workspaceId: 'w-remote', op: { kind: 'add', text: 'mine' } })
  assert.equal(added.status, 'ok')
  assert.equal(await readFile(join(folder, 'devbox', 'dev--ask.md'), 'utf8'), '- [ ] from an agent\n- [ ] mine\n')

  // The agent rewrote the file meanwhile: the stale toggle reports a conflict instead of clobbering.
  await writeFile(join(folder, 'devbox', 'dev--ask.md'), '- [x] from an agent\n- [ ] mine\n')
  const stale = await worker.request('scratch.edit', {
    workspaceId: 'w-remote',
    op: { kind: 'toggle', line: 0, expect: '- [ ] from an agent' }
  })
  assert.equal(stale.status === 'ok' && stale.message, 'The list changed; reloaded.')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
  await rm(folder, { recursive: true, force: true })
})

test('finds a paired-server workspace that workspace.list leaves out, by its id and project', async () => {
  const host = mockHost({
    results: {
      'workspace.readContext': { workspaceId: 'p1::/home/me/dev/personal/homelab', branch: 'main', displayName: 'homelab', terminals: [] },
      'workspace.list': { workspaces: [], truncated: false },
      'project.list': {
        projects: [{ id: 'p1', name: 'homelab', kind: 'git', hostId: 'runtime:abc', path: '/home/me/dev/personal/homelab' }],
        truncated: false
      }
    }
  })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('scratch.open', {}), {
    status: 'needs-host',
    workspaceId: 'p1::/home/me/dev/personal/homelab',
    workspaceName: 'homelab',
    hostId: 'runtime:abc'
  })
  await worker.deactivate()
})

test('opens a bot folder workspace on a paired server by its id', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'scratch-'))
  const host = mockHost({
    settings: { folder },
    storage: { hosts: { remote: 'devbox' } },
    results: {
      'workspace.readContext': { workspaceId: 'folder:f929', branch: '', displayName: 'homelab-ops', terminals: [] },
      'workspace.list': { workspaces: [], truncated: false }
    }
  })
  const worker = await mountWorker(main, { host })
  const opened = await worker.request('scratch.open', {})
  assert.equal(opened.status, 'ok')
  if (opened.status !== 'ok') return
  assert.equal(opened.workspaceName, 'homelab-ops')
  assert.equal(opened.rel, 'devbox/folder-f929.md')
  await worker.deactivate()
  await rm(folder, { recursive: true, force: true })
})

test('names a local workspace after this machine and creates the file on first add', async () => {
  const { folder, worker } = await setup()
  const added = await worker.request('scratch.edit', { workspaceId: 'w-local', op: { kind: 'add', text: 'first' } })
  assert.equal(added.status, 'ok')
  if (added.status !== 'ok') return
  assert.match(added.rel, /\/dev--quinoa\.md$/)
  assert.equal(await readFile(added.file, 'utf8'), '- [ ] first\n')
  await worker.deactivate()
  await rm(folder, { recursive: true, force: true })
})
