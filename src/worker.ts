// Reads and writes each workspace's list file and tells open panels when one changes on disk.
// Orca transpiles this file when it loads; a save restarts the worker, so the host-name map
// lives in orca.storage.
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import type { ScratchState } from './protocol'
import { cleanHost, expandHome, slugForWorkspace } from './paths'
import { apply, Conflict, parse, type Op } from './scratch'

const HOSTS = 'hosts'
/** Host key for a workspace whose host Orca does not name. */
const REMOTE = 'remote'

/** `b1c6…::/home/me/dev/x` -> project id and path; null for ids without a path. */
export function parseWorkspaceId(id: string): { projectId: string; path: string } | null {
  const at = id.indexOf('::')
  if (at < 0) return null
  const path = id.slice(at + 2)
  return path.startsWith('/') ? { projectId: id.slice(0, at), path } : null
}
const DEFAULT_FOLDER = '~/Sync/orca-scratch'

type Workspace = { id: string; name: string; path: string; hostId: string | null }
type Target = { workspace: Workspace; host: string; file: string; rel: string }

export default function activate(orca: OrcaWorkerApi): void {
  let watcher: FSWatcher | null = null
  let watchedDir = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  stop = () => {
    watcher?.close()
    if (timer) clearTimeout(timer)
  }

  async function hostNames(): Promise<Record<string, string>> {
    const value = await orca.storage.get(HOSTS)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, string>)
      : {}
  }

  async function folder(): Promise<string> {
    const value = await orca.settings.get('folder')
    const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_FOLDER
    return expandHome(raw, homedir())
  }

  async function findWorkspace(id?: string): Promise<Workspace | null> {
    const context = (await orca.host.call('workspace.readContext')) as {
      workspaceId?: string
      displayName?: string
    } | null
    const wanted = id ?? context?.workspaceId
    if (!wanted) {
      orca.log('no focused workspace in workspace.readContext')
      return null
    }
    const shownName = context?.workspaceId === wanted ? context.displayName : undefined
    const { workspaces } = await orca.host.call('workspace.list')
    const found = workspaces.find((w) => w.id === wanted) as Workspace | undefined
    if (found) return found
    // A folder workspace (a bot's, say) on a paired server: no path the desktop can see. It is
    // keyed by its id instead (slugForWorkspace), which agents look up from their session.
    if (wanted.startsWith('folder:')) {
      return { id: wanted, name: shownName || 'folder', path: '', hostId: REMOTE }
    }
    // The desktop's workspace.list leaves out workspaces on a paired Orca server, but their ids
    // read `<projectId>::<path>`, and project.list says which host that project lives on.
    const parsed = parseWorkspaceId(wanted)
    if (!parsed) {
      orca.log(`workspace ${wanted} is not in workspace.list and has no path in its id`)
      return null
    }
    let hostId = REMOTE
    try {
      const { projects } = await orca.host.call('project.list')
      const project = projects.find((p) => p.id === parsed.projectId)
      if (project) hostId = project.hostId ?? 'local'
    } catch (error) {
      orca.log(`project.list failed: ${String(error)}`)
    }
    return { id: wanted, name: basename(parsed.path), path: parsed.path, hostId }
  }

  /** The list file for a workspace, or the host id that still needs a name. */
  async function target(workspace: Workspace): Promise<Target | { needsHost: string }> {
    const local = !workspace.hostId || workspace.hostId === 'local'
    const host = local
      ? cleanHost(hostname())
      : (await hostNames())[workspace.hostId as string]
    if (!host) return { needsHost: workspace.hostId as string }
    const rel = `${host}/${slugForWorkspace(workspace.id, workspace.path)}.md`
    return { workspace, host, rel, file: join(await folder(), rel) }
  }

  function watchDir(dir: string): void {
    if (dir === watchedDir) return
    watcher?.close()
    watchedDir = dir
    try {
      watcher = watch(dir, () => {
        // Syncthing and editors write in bursts (temp file, rename): tell panels once it settles.
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => orca.panels.post('scratch.changed', { dir }), 150)
      })
    } catch (error) {
      watcher = null
      orca.log(`could not watch ${dir}: ${String(error)}`)
    }
  }

  async function readText(file: string): Promise<string> {
    try {
      return await readFile(file, 'utf8')
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return ''
      throw error
    }
  }

  async function state(workspace: Workspace | null, message?: string): Promise<ScratchState> {
    if (!workspace) return { status: 'no-workspace' }
    const t = await target(workspace)
    if ('needsHost' in t) {
      return {
        status: 'needs-host',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        hostId: t.needsHost
      }
    }
    await mkdir(dirname(t.file), { recursive: true })
    watchDir(dirname(t.file))
    const { items, notes } = parse(await readText(t.file))
    return {
      status: 'ok',
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      host: t.host,
      file: t.file,
      rel: t.rel,
      items,
      notes,
      ...(message ? { message } : {})
    }
  }

  async function edit(workspaceId: string, op: Op): Promise<ScratchState> {
    const workspace = await findWorkspace(workspaceId)
    if (!workspace) return { status: 'no-workspace' }
    const t = await target(workspace)
    if ('needsHost' in t) return state(workspace)
    const before = await readText(t.file)
    try {
      const after = apply(before, op)
      if (after !== before) {
        await mkdir(dirname(t.file), { recursive: true })
        await writeFile(t.file, after, 'utf8')
      }
      return state(workspace)
    } catch (error) {
      if (error instanceof Conflict) return state(workspace, error.message)
      throw error
    }
  }

  orca.panels.handle('scratch.open', async ({ workspaceId }) =>
    state(await findWorkspace(workspaceId))
  )

  orca.panels.handle('scratch.edit', async ({ workspaceId, op }) => edit(workspaceId, op))

  orca.panels.handle('scratch.nameHost', async ({ workspaceId, hostId, name }) => {
    const host = cleanHost(name)
    if (host) await orca.storage.set(HOSTS, { ...(await hostNames()), [hostId]: host })
    // Every open panel may be waiting on this name: an empty dir tells them all to reload.
    orca.panels.post('scratch.changed', { dir: '' })
    return state(await findWorkspace(workspaceId))
  })
}

let stop = (): void => {}

export function deactivate(): void {
  stop()
}
