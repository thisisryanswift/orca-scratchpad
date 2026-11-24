# Design notes

Why Scratchpad is built the way it is, and the Orca behaviour it works around. Findings are from
Orca 1.4.269–1.4.271 (November 2026).

## The problem

A short to-do list per workspace, in Orca's right sidebar, that the user and their agents both
edit. The motivating setup is common and is what every existing catalog plugin breaks on:

- The Orca **desktop app** runs on one machine and pairs with a headless **Orca server**
  (`orca serve`) on another, where the workspaces and agents live. In the author's setup these
  are a laptop, `marlin`, and a server, `reef`, joined by Tailscale.
- Plugin code, panels and workers alike, runs only in the **desktop app**. The server build has
  no plugin service (`orca plugin list` there: "Plugin service is not available on this runtime").

## Prior art (community catalog, Nov 2026)

Of roughly 390 catalog plugins, eight are to-do or notes panels. Only `jonstuebe.todos` lets
agents edit the same data (a `TODO.md` in the worktree), but its worker reads that file with the
desktop machine's local filesystem, so it fails for workspaces on a paired server. The rest keep
data in plugin storage, which agents cannot see, or in one global folder.

## Decisions

**Plain Markdown files.** Agents need no tool, MCP server or skill: Orca reserves those
contribution points for plugins anyway. One instruction line and the agent edits `- [ ]` lines.
Lines that are not top-level bullets are kept untouched and shown as Notes.

**A synced folder, not SSH.** The plugin host API has no way to read files in a workspace, local
or remote. SSH from the worker was considered and rejected because
it would not stay connected in the author's setup. With Tailscale SSH in check mode,
connections need a browser approval every 12 hours (the period is fixed on the free plan), and
an `accept` rule for one personal device cannot be written (SSH rule sources cannot be single
user-owned devices, and an overlapping `check` rule wins over `accept`). Syncthing already shared
`~/Sync` between the machines, so the lists live there and the plugin needs no network access.
Its fs watcher delay was lowered to 1 s; a change reaches the other machine in about 2–3 s.
Any tool that mirrors a folder works the same way; on a single machine nothing needs syncing.

**Files outside the worktree.** Keeps lists out of `git status` and commits, and lets one folder
serve every host: `<folder>/<host>/<slug>.md`.

**Edits are line-addressed and checked.** Every edit carries the line number and the line's
exact previous text. If the file changed underneath (an agent, a sync), the worker refuses the
edit, reloads and says so rather than overwriting.

**Minimal access.** `workspace:read`, `storage:own` (host-name map), `settings:own` (folder
setting). No terminal, agent or network capability.

## Orca quirks this works around

Each was found against the live desktop app; none is in the plugin docs.

- **`workspace.list` omits paired-server workspaces** on the desktop: it returned zero rows while
  workspaces on the paired server were open. `project.list` did not name their host either.
  *Workaround:* workspace ids read `<projectId>::<absolute path>`; the worker parses the path.
  All unresolved hosts share one name key (`remote`), which the panel asks the user for once.
  With two paired servers this would be ambiguous.
- **Folder workspaces (bots) have ids `folder:<uuid>`** with no path the desktop can see; a bot
  runs in `~/.orca/bots/<name>` on the server. *Workaround:* those lists are keyed by id
  (`folder-<uuid>.md`), and the agent helper finds the id by asking Orca for its own session
  (`orca agent show $ORCA_AGENT_SESSION_ID`). Agents get no workspace id in their environment.
- **`workspace.changed` can arrive without `workspaceId`** for paired-server workspaces, so
  comparing ids treated every switch as "no change". *Workaround:* an event without an id always
  re-reads `workspace.readContext`.
- **There is a short delay** between a workspace switch and the new list. The panel hides the old
  list immediately on a known switch so an item typed meanwhile cannot land in the wrong file.
  For id-less events it cannot tell a switch from a terminal change until it asks, so the old list
  stays visible for that moment.

Reported upstream: [stablyai/orca#48366](https://github.com/stablyai/orca/issues/48366) (the first and third)
and [#48367](https://github.com/stablyai/orca/issues/48367) (the second).

## Known limits

- One name for all unresolved remote hosts (see above).
- Two people or agents editing the same line within the sync window produce a Syncthing
  `.sync-conflict` file; Syncthing keeps old versions in `.stversions`.
- Item text is single-line; the panel collapses whitespace.
