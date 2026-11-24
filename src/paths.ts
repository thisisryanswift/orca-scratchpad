// Where a workspace's list lives: <folder>/<host>/<slug>.md. Agents compute the same path with
// the `scratch` helper (agent/scratch), so keep the two in step.

/** `/home/me/dev/ask` -> `dev--ask`; a path outside a home folder keeps everything after `/`. */
export function slugFor(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const m = /^\/(?:home|Users)\/[^/]+\/?(.*)$/.exec(trimmed)
  const rest = m ? m[1] : trimmed.replace(/^\/+/, '')
  const slug = rest
    .split('/')
    .filter(Boolean)
    .join('--')
    .replace(/[^A-Za-z0-9._-]/g, '_')
  return slug || '_home'
}

/**
 * The list's file name for a workspace. Folder workspaces (bots, for one) have ids like
 * `folder:<uuid>` and no path a paired desktop can see, so they are keyed by that id; every
 * other workspace by its path.
 */
export function slugForWorkspace(id: string, path: string): string {
  if (id.startsWith('folder:')) return `folder-${id.slice(7).replace(/[^A-Za-z0-9-]/g, '_')}`
  return slugFor(path)
}

/** A host name safe to use as a folder name. */
export function cleanHost(name: string): string {
  return name.trim().split('.')[0].replace(/[^A-Za-z0-9_-]/g, '_')
}

export function expandHome(path: string, home: string): string {
  return path === '~' ? home : path.startsWith('~/') ? home + path.slice(1) : path
}
