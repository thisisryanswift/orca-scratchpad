# Scratchpad (Orca plugin)

An Orca right-sidebar panel: a per-workspace to-do list stored as Markdown in a synced folder, so
agents edit the same list. `README.md` covers usage; read `docs/DESIGN.md` before changing how
lists are located, how workspaces are resolved, or how edits are written: it records the Orca
quirks the code works around and why SSH and plugin storage were rejected.

## Where to run things

Plugin code, tests included, runs only where the Orca **desktop app** runs. A headless
`orca serve` build has no plugin service, so `orca plugin test`/`check` fail there.

### The author's setup

The desktop app runs on **marlin**; this repo lives on **reef**, where the Orca server runs.
If you are on reef, edit and commit here, and test on marlin:

- Copy to marlin:
  `rsync -a -e 'command ssh -o BatchMode=yes' --exclude .git --exclude .orca ./ marlin:dev/personal/orca-scratchpad/`
- On marlin, the Orca IDE CLI is `~/.config/orca/linux-orca-cli-shim/orca`; plain `orca` there is
  the GNOME screen reader.
- SSH to marlin uses Tailscale check mode: a hanging connection that prints a
  `login.tailscale.com` link needs the user to approve it.
- The plugin is loaded on marlin in development mode as `local.scratchpad`, from that copy:
  syncing reloads the user's live panel.

## Done means

Run where the desktop app is (on marlin, in the copy): `plugin test .`, `plugin check . --json`,
and `npx -p typescript@5.6.3 tsc -p . --noEmit` (first run `plugin types .`). All green, and
`plugin validate . --json` with no warnings. For UI changes, `plugin shot local.scratchpad --panel
scratchpad --out <png>` and look at the image.

## Invariants

- `src/paths.ts` and `agent/scratch` compute the same file name for a workspace; change them
  together and keep the `slugs …`/`keys folder workspaces …` tests in step.
- The worker writes only under the configured scratch folder, and every edit is checked against
  the line's previous text (`apply` throws `Conflict`).
- Capabilities stay `workspace:read`, `storage:own`, `settings:own`. A new capability makes the
  user re-approve the plugin; raise it with them first.
- Tests and examples use made-up hosts and paths (`devbox`, `/home/me`), not real machine names.
