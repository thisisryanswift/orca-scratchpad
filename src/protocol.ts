// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Item, Op } from './scratch'

export type ScratchState =
  | { status: 'no-workspace' }
  | { status: 'needs-host'; workspaceId: string; workspaceName: string; hostId: string }
  | {
      status: 'ok'
      workspaceId: string
      workspaceName: string
      host: string
      /** Absolute path of the list file on this machine. */
      file: string
      /** `<host>/<slug>.md`, relative to the scratch folder. */
      rel: string
      items: Item[]
      notes: string
      /** Set when an edit could not apply because the file had changed. */
      message?: string
    }

declare module 'orca' {
  interface PluginRequests {
    /** The list of the given workspace, or of the focused one. */
    'scratch.open': { input: { workspaceId?: string }; output: ScratchState }
    /** Applies one edit to a workspace's list and answers the new state. */
    'scratch.edit': { input: { workspaceId: string; op: Op }; output: ScratchState }
    /** Remembers the folder name for a remote host, then answers that workspace's list. */
    'scratch.nameHost': {
      input: { workspaceId: string; hostId: string; name: string }
      output: ScratchState
    }
  }
  interface PluginPanelEvents {
    /** A file changed in this host folder on disk (an agent, Syncthing, or another panel). */
    'scratch.changed': { dir: string }
  }
}
