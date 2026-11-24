// The right-sidebar list. The worker owns the file; this panel only asks it to read and edit.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Checkbox,
  Collapsible,
  EmptyState,
  Heading,
  IconButton,
  Input,
  Markdown,
  on,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { ScratchState } from './protocol'
import type { Item, Op } from './scratch'

const state = atom<ScratchState | null>(null)
/** The workspace Orca last reported as focused; undefined until it does. */
const focused = atom<string | undefined>(undefined)
const draft = atom('')
const editing = atom<number | null>(null)
const editText = atom('')
const hostDraft = atom('')
/** Drops answers that arrive after a newer request. */
const latest = atom(0)

async function load(): Promise<void> {
  const ticket = read(latest) + 1
  set(latest, ticket)
  const id = read(focused)
  const answer = await plugin.request('scratch.open', id ? { workspaceId: id } : {})
  if (read(latest) === ticket) set(state, answer)
}

async function run(op: Op): Promise<void> {
  const current = read(state)
  if (current?.status !== 'ok') return
  const ticket = read(latest) + 1
  set(latest, ticket)
  const answer = await plugin.request('scratch.edit', { workspaceId: current.workspaceId, op })
  if (read(latest) === ticket) set(state, answer)
}

async function add(): Promise<void> {
  const text = read(draft).trim()
  if (!text) return
  set(draft, '')
  await run({ kind: 'add', text })
}

function startEdit(item: Item): void {
  set(editing, item.line)
  set(editText, item.text)
}

async function saveEdit(item: Item): Promise<void> {
  const text = read(editText)
  set(editing, null)
  await run({ kind: 'edit', line: item.line, expect: item.raw, text })
}

async function nameHost(): Promise<void> {
  const current = read(state)
  const name = read(hostDraft).trim()
  if (current?.status !== 'needs-host' || !name) return
  set(
    state,
    await plugin.request('scratch.nameHost', {
      workspaceId: current.workspaceId,
      hostId: current.hostId,
      name
    })
  )
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    // Fires once with the current context as we subscribe, then on every focus change and when
    // terminals open, close or are renamed. For workspaces on a paired server the context can
    // come without a workspaceId, so an event without one always asks Orca again.
    on('workspace.changed', ({ context }) => {
      const id = context?.workspaceId
      const shown = read(state)
      const shownId = shown && shown.status !== 'no-workspace' ? shown.workspaceId : undefined
      if (id && id === shownId) return // same workspace: a terminal changed, nothing to reload
      set(focused, id) // undefined: load() asks Orca which workspace is focused
      set(editing, null)
      // A known switch drops the old list at once, so typing cannot land in it while loading.
      if (id && shown) set(state, null)
      void load()
    }),
    plugin.on('scratch.changed', ({ dir }) => {
      const current = read(state)
      if (current?.status !== 'ok' || current.file.startsWith(dir)) void load()
    })
  )
  void load()
}

function ItemRow({ item, first, last }: { item: Item; first: boolean; last: boolean }) {
  if (read(editing) === item.line) {
    return (
      <Row gap="xs" align="center">
        <Box grow shrink minWidth={0}>
          <Input
            label="Edit item"
            labelHidden
            value={read(editText)}
            onChange={(value) => set(editText, value)}
            onSubmit={() => saveEdit(item)}
          />
        </Box>
        <IconButton icon="check" label="Save" size="xs" variant="ghost" onPress={() => saveEdit(item)} />
        <IconButton icon="close" label="Cancel" size="xs" variant="ghost" onPress={() => set(editing, null)} />
      </Row>
    )
  }
  const at = { line: item.line, expect: item.raw }
  return (
    <Box direction="row" gap="xs" align="start" justify="between">
      {/* minWidth 0 lets long items wrap instead of pushing the buttons out of the panel. */}
      <Box grow shrink minWidth={0}>
        <Checkbox
          label={item.text}
          checked={item.done}
          onChange={() => run({ kind: 'toggle', ...at })}
        />
      </Box>
      <Box direction="row" gap="none" align="center" shrink={false}>
        <IconButton icon="edit" label={`Edit ${item.text}`} tooltip="Edit" size="xs" variant="ghost" onPress={() => startEdit(item)} />
        <IconButton icon="collapse" label={`Move ${item.text} up`} tooltip="Move up" size="xs" variant="ghost" disabled={first} onPress={() => run({ kind: 'move', dir: -1, ...at })} />
        <IconButton icon="expand" label={`Move ${item.text} down`} tooltip="Move down" size="xs" variant="ghost" disabled={last} onPress={() => run({ kind: 'move', dir: 1, ...at })} />
        <IconButton icon="delete" label={`Delete ${item.text}`} tooltip="Delete" size="xs" variant="ghost" onPress={() => run({ kind: 'remove', ...at })} />
      </Box>
    </Box>
  )
}

export default function Panel() {
  const s = read(state)
  if (!s) return <Skeleton lines={3} label="Loading the scratchpad" />
  if (s.status === 'no-workspace') {
    return (
      <EmptyState
        icon="check"
        title="No workspace focused"
        description="Open a workspace to see its scratchpad."
      />
    )
  }
  if (s.status === 'needs-host') {
    return (
      <Stack gap="md">
        <Callout tone="accent" icon="info" title="Which server is this?">
          <Text>
            {`${s.workspaceName} runs on another Orca host. Enter that machine's short hostname (what \`hostname -s\` prints there), so this panel and the agents there use the same list.`}
          </Text>
        </Callout>
        <Input
          label="Host name"
          placeholder="devbox"
          value={read(hostDraft)}
          onChange={(value) => set(hostDraft, value)}
          onSubmit={nameHost}
        />
        <Button onPress={nameHost} disabled={!read(hostDraft).trim()}>
          Save
        </Button>
      </Stack>
    )
  }
  const open = s.items.filter((i) => !i.done).length
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Heading level={3}>{s.workspaceName}</Heading>
        <Badge tone={open ? 'accent' : 'neutral'}>{`${open} open`}</Badge>
      </Row>
      {s.message ? <Callout tone="warning">{s.message}</Callout> : null}
      <Input
        label="Add an item"
        labelHidden
        placeholder={`Add to ${s.workspaceName}…`}
        value={read(draft)}
        onChange={(value) => set(draft, value)}
        onSubmit={add}
      />
      {s.items.length === 0 ? (
        <EmptyState icon="check" title="Nothing here yet" description="Add an item, or ask an agent to." />
      ) : (
        <Stack gap="xs">
          {s.items.map((item, n) => (
            <ItemRow item={item} first={n === 0} last={n === s.items.length - 1} />
          ))}
        </Stack>
      )}
      {s.items.some((i) => i.done) ? (
        <Row justify="end">
          <Button variant="ghost" size="sm" icon="delete" onPress={() => run({ kind: 'clearDone' })}>
            Clear done
          </Button>
        </Row>
      ) : null}
      {s.notes ? (
        <Collapsible title="Notes">
          <Markdown content={s.notes} />
        </Collapsible>
      ) : null}
      <Text muted size="xs" truncate>
        {s.rel}
      </Text>
    </Stack>
  )
}
