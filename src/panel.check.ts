// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh host.
import { defineCheck } from 'orca/testing'

const context = { workspaceId: 'w1', branch: 'main', displayName: 'ask', terminals: [] }
const list = (hostId: string) => ({
  workspaces: [{ id: 'w1', kind: 'folder', name: 'ask', path: '/home/me/dev/ask', branch: null, hostId }],
  truncated: false
})

export default defineCheck({
  noWorkspace: { results: { 'workspace.readContext': null, 'workspace.list': { workspaces: [], truncated: false } } },
  remoteUnnamed: { results: { 'workspace.readContext': context, 'workspace.list': list('runtime:abc') } },
  local: {
    settings: { folder: '/tmp/scratchpad-check' },
    results: { 'workspace.readContext': context, 'workspace.list': list('local') }
  }
})
