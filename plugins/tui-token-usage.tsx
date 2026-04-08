/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"

const id = "tui-token-usage"
const route = "token-usage"

const gran = ["15min", "30min", "hour", "day", "week", "month"] as const
const metr = ["tokens", "cost", "both"] as const

type Gran = (typeof gran)[number]
type Metr = (typeof metr)[number]

type Row = {
  key: number
  label: string
  tokens: number
  cost: number
}

type Data = {
  rows: Row[]
  total: {
    tokens: number
    cost: number
  }
  debug: {
    lines: string[]
  }
}

type LoadOptions = {
  force?: boolean
  shouldStop?: () => boolean
}

type Scope = "all" | "workspace" | "session"

type Bin = {
  tokens: number
  cost: number
}

type SessionAggregate = {
  stamp: string
  bins: Map<number, Bin>
  total: Bin
  stats: {
    messages: number
    assistant: number
    inRange: number
    cached: boolean
    error?: string
  }
}

type GlobalCallOptions = {
  headers: {
    "x-opencode-directory": string
    "x-opencode-workspace": string
  }
}

const GLOBAL_CALL_OPTIONS: GlobalCallOptions = {
  headers: {
    "x-opencode-directory": "",
    "x-opencode-workspace": "",
  },
}

type BackTarget =
  | { name: "home" }
  | {
      name: "session"
      params: {
        sessionID: string
      }
    }

const sessionAggregateCache = new Map<string, SessionAggregate>()
const CACHE_VERSION = "v6"

function isFastMode(mode: Gran) {
  return mode === "15min" || mode === "30min" || mode === "hour"
}

function messageLimit(mode: Gran) {
  if (mode === "15min") return 400
  if (mode === "30min") return 500
  if (mode === "hour") return 800
  if (mode === "day") return 2000
  if (mode === "week") return 4000
  return 6000
}

function sessionListLimit(mode: Gran) {
  return isFastMode(mode) ? 5000 : 20000
}

function count(input: Gran) {
  if (input === "15min") return 48
  if (input === "30min") return 48
  if (input === "hour") return 24
  if (input === "day") return 30
  if (input === "week") return 20
  return 12
}

function start(ts: number, mode: Gran) {
  const d = new Date(ts)
  if (mode === "15min") {
    const minute = d.getMinutes()
    d.setMinutes(minute - (minute % 15), 0, 0)
    return d.getTime()
  }
  if (mode === "30min") {
    const minute = d.getMinutes()
    d.setMinutes(minute - (minute % 30), 0, 0)
    return d.getTime()
  }
  if (mode === "hour") {
    d.setMinutes(0, 0, 0)
    return d.getTime()
  }
  if (mode === "day") {
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (mode === "week") {
    d.setHours(0, 0, 0, 0)
    const day = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - day)
    return d.getTime()
  }
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d.getTime()
}

function label(ts: number, mode: Gran) {
  const d = new Date(ts)
  if (mode === "15min" || mode === "30min") {
    return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
  }
  if (mode === "hour") return d.toLocaleString(undefined, { hour: "2-digit", day: "2-digit", month: "2-digit" })
  if (mode === "day") return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })
  if (mode === "week") {
    const w = week(d)
    return `W${w.number} ${w.year}`
  }
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
}

function week(d: Date) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7))
  const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return {
    number: Math.ceil(((x.getTime() - y.getTime()) / 86400000 + 1) / 7),
    year: x.getUTCFullYear(),
  }
}

function add(ts: number, mode: Gran, amount: number) {
  const d = new Date(ts)
  if (mode === "15min") {
    d.setMinutes(d.getMinutes() + amount * 15)
    return d.getTime()
  }
  if (mode === "30min") {
    d.setMinutes(d.getMinutes() + amount * 30)
    return d.getTime()
  }
  if (mode === "hour") {
    d.setHours(d.getHours() + amount)
    return d.getTime()
  }
  if (mode === "day") {
    d.setDate(d.getDate() + amount)
    return d.getTime()
  }
  if (mode === "week") {
    d.setDate(d.getDate() + amount * 7)
    return d.getTime()
  }
  d.setMonth(d.getMonth() + amount)
  return d.getTime()
}

function buildRows(mode: Gran, now = Date.now()) {
  const n = count(mode)
  const end = start(now, mode)
  const first = add(end, mode, -(n - 1))
  return Array.from({ length: n }, (_, i) => {
    const key = add(first, mode, i)
    return {
      key,
      label: label(key, mode),
      tokens: 0,
      cost: 0,
    }
  })
}

function tok(msg: {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}) {
  return msg.input + msg.output + msg.reasoning + msg.cache.read + msg.cache.write
}

function sessionStamp(session: unknown) {
  if (!session || typeof session !== "object") return ""
  const value = session as {
    id?: unknown
    time?: { updated?: unknown; created?: unknown }
    version?: unknown
  }
  const id = typeof value.id === "string" ? value.id : ""
  const updated = typeof value.time?.updated === "number" ? value.time.updated : undefined
  const created = typeof value.time?.created === "number" ? value.time.created : undefined
  const version = typeof value.version === "string" ? value.version : ""
  return `${id}:${updated ?? created ?? ""}:${version}`
}

async function aggregateSession(
  client: TuiPluginApi["client"],
  sessionID: string,
  directory: string | undefined,
  stamp: string,
  mode: Gran,
  range: { start: number; end: number },
  options: Pick<LoadOptions, "shouldStop">,
) {
  const key = `${directory ?? "default"}:${sessionID}:${mode}:${range.start}:${range.end}`
  const cached = sessionAggregateCache.get(key)
  if (cached && cached.stamp === stamp) {
    return {
      ...cached,
      stats: {
        ...cached.stats,
        cached: true,
      },
    }
  }

  if (options.shouldStop?.()) {
    return {
      stamp,
      bins: new Map<number, Bin>(),
      total: { tokens: 0, cost: 0 },
      stats: {
        messages: 0,
        assistant: 0,
        inRange: 0,
        cached: false,
      },
    } satisfies SessionAggregate
  }

  let messageError: string | undefined
  const messages = await client.session
    .messages({ sessionID, directory, limit: messageLimit(mode) } as { sessionID: string; directory?: string; limit: number }, GLOBAL_CALL_OPTIONS)
    .then((x) => x.data ?? [])
    .catch((error) => {
      messageError = error instanceof Error ? error.message : String(error)
      return []
    })

  const bins = new Map<number, Bin>()
  let total: Bin = {
    tokens: 0,
    cost: 0,
  }
  let assistantCount = 0
  let inRangeCount = 0

  for (let i = messages.length - 1; i >= 0; i--) {
    if (options.shouldStop?.()) break
    const info = messages[i].info
    if (info.role !== "assistant") continue
    assistantCount++
    const created = info.time.created
    if (created >= range.end) continue
    if (created < range.start) continue
    inRangeCount++

    const bucket = start(created, mode)
    const value = bins.get(bucket) ?? { tokens: 0, cost: 0 }
    const tokens = tok(info.tokens)
    value.tokens += tokens
    value.cost += info.cost
    bins.set(bucket, value)
    total.tokens += tokens
    total.cost += info.cost
  }

  const out: SessionAggregate = {
    stamp,
    bins,
    total,
    stats: {
      messages: messages.length,
      assistant: assistantCount,
      inRange: inRangeCount,
      cached: false,
      error: messageError,
    },
  }
  sessionAggregateCache.set(key, out)
  if (sessionAggregateCache.size > 500) {
    const oldest = sessionAggregateCache.keys().next().value
    if (oldest) sessionAggregateCache.delete(oldest)
  }
  return out
}

async function load(
  api: TuiPluginApi,
  mode: Gran,
  scope: Scope,
  ref: { sessionID?: string; workspaceID?: string },
  options: LoadOptions = {},
) {
  const debugLines: string[] = []

  const apiWithScopes = api as TuiPluginApi & {
    scopedClient?: (workspaceID?: string) => TuiPluginApi["client"]
    state?: {
      workspace?: {
        list?: () => Array<{ id?: string }>
      }
    }
  }

  const workspaceIDs = Array.from(
    new Set(
      (apiWithScopes.state?.workspace?.list?.() ?? [])
        .map((item) => item?.id)
        .filter((item): item is string => typeof item === "string" && item.length > 0),
    ),
  )

  const allScopeRef = workspaceIDs.length > 0 ? `all:${workspaceIDs.sort().join(",")}` : "all"
  const scopeRef = scope === "session" ? ref.sessionID ?? "none" : scope === "workspace" ? ref.workspaceID ?? "none" : "all"
  const key = `token-usage-cache:${CACHE_VERSION}:${mode}:${scope}:${scope === "all" ? allScopeRef : scopeRef}`
  const hit = api.kv.get<{ time: number; data: Data } | undefined>(key, undefined)
  if (!options.force && hit && Date.now() - hit.time < 5 * 60 * 1000) {
    return {
      ...hit.data,
      debug: {
        lines: [
          ...(hit.data.debug?.lines ?? []),
          `cache hit key=${key}`,
          `cache age ms=${Date.now() - hit.time}`,
        ],
      },
    }
  }

  const rows = buildRows(mode)

  const idx = new Map(rows.map((item, i) => [item.key, i]))
  const range = {
    start: rows[0]?.key ?? 0,
    end: add(rows[rows.length - 1]?.key ?? 0, mode, 1),
  }

  debugLines.push(`cache miss key=${key}`)
  debugLines.push(`scope=${scope} mode=${mode}`)
  debugLines.push(`workspace ids=${workspaceIDs.length}`)
  debugLines.push(`window start=${new Date(range.start).toISOString()} end=${new Date(range.end).toISOString()}`)

  const clientSources: Array<{ key: string; client: TuiPluginApi["client"] }> = []
  if (scope === "workspace") {
    if (ref.workspaceID && apiWithScopes.scopedClient) {
      clientSources.push({ key: `workspace:${ref.workspaceID}`, client: apiWithScopes.scopedClient(ref.workspaceID) })
    } else {
      clientSources.push({ key: "workspace:default", client: api.client })
    }
  } else if (scope === "all") {
    clientSources.push({ key: "all:default", client: api.client })
    if (apiWithScopes.scopedClient) {
      workspaceIDs.forEach((workspaceID) => {
        clientSources.push({ key: `all:${workspaceID}`, client: apiWithScopes.scopedClient?.(workspaceID) ?? api.client })
      })
    }
  } else {
    clientSources.push({ key: "session", client: api.client })
  }
  debugLines.push(`client sources=${clientSources.map((item) => item.key).join(",")}`)

  let sessions: Array<{ id: string; stamp: string; client: TuiPluginApi["client"]; directory?: string }> = []
  if (scope === "session") {
    if (!ref.sessionID) {
      return {
        rows,
        total: { tokens: 0, cost: 0 },
        debug: {
          lines: [...debugLines, "missing sessionID for session scope"],
        },
      }
    }
    sessions = [{ id: ref.sessionID, stamp: ref.sessionID, client: api.client, directory: undefined }]
  } else {
    const dedup = new Map<string, { id: string; stamp: string; client: TuiPluginApi["client"]; directory?: string }>()

    const globalList = await api.client.session
      .list({ limit: sessionListLimit(mode) }, GLOBAL_CALL_OPTIONS)
      .then((x) => x.data ?? [])
      .catch(() => [])
    debugLines.push(`sessions from global override: ${globalList.length}`)
    globalList.forEach((item) => {
      if (!item?.id) return
      if (dedup.has(item.id)) return
      dedup.set(item.id, {
        id: item.id,
        stamp: sessionStamp(item) || item.id,
        client: api.client,
        directory: undefined,
      })
    })

    const projects = await api.client.project
      .list(undefined, GLOBAL_CALL_OPTIONS)
      .then((x) => x.data ?? [])
      .catch(() => [])
    debugLines.push(`projects discovered: ${projects.length}`)

    for (const project of projects) {
      if (!project?.worktree) continue
      const list = await api.client.session
        .list({ directory: project.worktree, limit: sessionListLimit(mode) }, GLOBAL_CALL_OPTIONS)
        .then((x) => x.data ?? [])
        .catch(() => [])
      debugLines.push(`sessions from project ${project.worktree}: ${list.length}`)
      list.forEach((item) => {
        if (!item?.id) return
        if (dedup.has(item.id)) return
        dedup.set(item.id, {
          id: item.id,
          stamp: sessionStamp(item) || item.id,
          client: api.client,
          directory: project.worktree,
        })
      })
    }

    for (const source of clientSources) {
      if (options.shouldStop?.()) break
      const list = await source.client.session
        .list({ limit: sessionListLimit(mode) }, GLOBAL_CALL_OPTIONS)
        .then((x) => x.data ?? [])
        .catch(() => [])
      debugLines.push(`sessions from ${source.key}: ${list.length}`)
      list.forEach((item) => {
        if (!item?.id) return
        if (dedup.has(item.id)) return
        dedup.set(item.id, {
          id: item.id,
          stamp: sessionStamp(item) || item.id,
          client: source.client,
          directory: undefined,
        })
      })
    }
    sessions = Array.from(dedup.values())
  }
  debugLines.push(`dedup sessions=${sessions.length}`)

  const size = isFastMode(mode) ? 6 : 10

  let total = {
    tokens: 0,
    cost: 0,
  }
  let totalMessagesScanned = 0
  let totalAssistantMessages = 0
  let totalInRangeMessages = 0
  let cachedSessionCount = 0
  let sessionFetchErrors = 0

  for (let i = 0; i < sessions.length; i += size) {
    if (options.shouldStop?.()) break
    const part = sessions.slice(i, i + size)
    const packs = await Promise.all(
      part.map((session) =>
        aggregateSession(session.client, session.id, session.directory, session.stamp, mode, range, options).catch(() => ({
          stamp: session.stamp,
          bins: new Map<number, Bin>(),
          total: { tokens: 0, cost: 0 },
          stats: {
            messages: 0,
            assistant: 0,
            inRange: 0,
            cached: false,
            error: "aggregateSession failed",
          },
        })),
      ),
    )

    packs.forEach((pack) => {
      pack.bins.forEach((value, bucket) => {
        const rowIndex = idx.get(bucket)
        if (rowIndex === undefined) return
        rows[rowIndex].tokens += value.tokens
        rows[rowIndex].cost += value.cost
      })
      total.tokens += pack.total.tokens
      total.cost += pack.total.cost
      totalMessagesScanned += pack.stats.messages
      totalAssistantMessages += pack.stats.assistant
      totalInRangeMessages += pack.stats.inRange
      if (pack.stats.cached) cachedSessionCount++
      if (pack.stats.error) sessionFetchErrors++
    })
  }

  const rowsWithData = rows.reduce((count, row) => (row.tokens > 0 || row.cost > 0 ? count + 1 : count), 0)
  debugLines.push(`messages scanned=${totalMessagesScanned}`)
  debugLines.push(`assistant messages=${totalAssistantMessages}`)
  debugLines.push(`assistant in window=${totalInRangeMessages}`)
  debugLines.push(`session cache hits=${cachedSessionCount}`)
  debugLines.push(`session fetch errors=${sessionFetchErrors}`)
  debugLines.push(`rows with data=${rowsWithData}/${rows.length}`)
  debugLines.push(`total tokens=${Math.round(total.tokens)} total cost=${total.cost.toFixed(4)}`)

  const out = {
    rows,
    total,
    debug: {
      lines: debugLines,
    },
  } satisfies Data

  api.kv.set(key, { time: Date.now(), data: out })
  return out
}

function fmt(input: number) {
  if (input >= 1000000) return `${(input / 1000000).toFixed(1)}M`
  if (input >= 1000) return `${(input / 1000).toFixed(1)}K`
  return `${Math.round(input)}`
}

function bar(size: number) {
  if (size <= 0) return ""
  return "#".repeat(size)
}

function barWith(size: number, char: string) {
  if (size <= 0) return ""
  return char.repeat(size)
}

function next<Value extends string>(all: readonly Value[], cur: Value, dir: 1 | -1) {
  const i = all.indexOf(cur)
  if (i === -1) return all[0]
  const len = all.length
  return all[(i + dir + len) % len]
}

function parseBackTarget(input: unknown): BackTarget {
  if (!input || typeof input !== "object") return { name: "home" }
  const data = input as { back?: unknown }
  if (!data.back || typeof data.back !== "object") return { name: "home" }
  const back = data.back as { name?: unknown; params?: unknown }

  if (back.name === "session") {
    const params = back.params as { sessionID?: unknown } | undefined
    if (params && typeof params.sessionID === "string" && params.sessionID.length > 0) {
      return {
        name: "session",
        params: {
          sessionID: params.sessionID,
        },
      }
    }
  }

  return { name: "home" }
}

function View(props: { api: TuiPluginApi; back: BackTarget }) {
  const dim = useTerminalDimensions()
  const [mode, setMode] = createSignal<Gran>("day")
  const [kind, setKind] = createSignal<Metr>("tokens")
  const [scope, setScope] = createSignal<Scope>(props.back.name === "session" ? "session" : "all")
  const [debug, setDebug] = createSignal(false)
  const [busy, setBusy] = createSignal(true)
  const [err, setErr] = createSignal<string>()
  const [data, setData] = createSignal<Data>({ rows: [], total: { tokens: 0, cost: 0 }, debug: { lines: [] } })
  const [lastRefreshAt, setLastRefreshAt] = createSignal<number>()
  let requestID = 0
  let disposed = false

  onCleanup(() => {
    disposed = true
  })

  const workspaceID = () => {
    const apiWithWorkspace = props.api as TuiPluginApi & {
      workspace?: {
        current?: () => string | undefined
      }
    }
    return apiWithWorkspace.workspace?.current?.()
  }
  const scopeList = createMemo<Scope[]>(() => {
    const out: Scope[] = ["all"]
    if (workspaceID()) out.push("workspace")
    if (props.back.name === "session") out.push("session")
    return out
  })

  const pull = (force = false) => {
    const id = ++requestID
    setBusy(true)
    setErr(undefined)
    load(
      props.api,
      mode(),
      scope(),
      {
        sessionID: props.back.name === "session" ? props.back.params.sessionID : undefined,
        workspaceID: workspaceID(),
      },
      {
        force,
        shouldStop: () => disposed || id !== requestID || props.api.route.current.name !== route,
      },
    )
      .then((value) => {
        if (disposed || id !== requestID) return
        setData(value)
        setLastRefreshAt(Date.now())
      })
      .catch((e) => {
        if (disposed || id !== requestID) return
        setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (disposed || id !== requestID) return
        setBusy(false)
      })
  }

  const view = createMemo(() => {
    const rows = data().rows
    const maxTokens = rows.reduce((acc, item) => Math.max(acc, item.tokens), 0)
    const maxCost = rows.reduce((acc, item) => Math.max(acc, item.cost), 0)
    const both = kind() === "both"
    const width = both ? Math.max(8, Math.floor(dim().width * 0.18)) : Math.max(12, Math.floor(dim().width * 0.38))

    return rows.map((item) => {
      const tokenSize = maxTokens <= 0 ? 0 : Math.max(1, Math.round((item.tokens / maxTokens) * width))
      const costSize = maxCost <= 0 ? 0 : Math.max(1, Math.round((item.cost / maxCost) * width))
      const size = kind() === "cost" ? costSize : kind() === "tokens" ? tokenSize : 0
      return {
        ...item,
        size,
        tokenSize,
        costSize,
      }
    })
  })

  useKeyboard((evt) => {
    if (props.api.route.current.name !== route) return
    const key = (evt.name ?? "").toLowerCase()

    if (evt.name === "escape") {
      evt.preventDefault()
      evt.stopPropagation()
      if (props.back.name === "session") {
        props.api.route.navigate("session", props.back.params)
      } else {
        props.api.route.navigate("home")
      }
      return
    }

    if (key === "r" || key === "f5" || (evt.ctrl && key === "r")) {
      evt.preventDefault()
      evt.stopPropagation()
      pull(true)
      return
    }

    if (evt.name === "d") {
      evt.preventDefault()
      evt.stopPropagation()
      setDebug((value) => !value)
      return
    }

    if (evt.name === "s") {
      evt.preventDefault()
      evt.stopPropagation()
      setScope((x) => next(scopeList(), x, 1))
      return
    }

    if (evt.name === "tab" || evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      evt.stopPropagation()
      setMode((x) => next(gran, x, 1))
      return
    }

    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      evt.stopPropagation()
      setMode((x) => next(gran, x, -1))
      return
    }

    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      evt.stopPropagation()
      setKind((x) => next(metr, x, 1))
      return
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      evt.stopPropagation()
      setKind((x) => next(metr, x, -1))
      return
    }
  })

  createEffect(() => {
    mode()
    scope()
    pull()
  })

  createEffect(() => {
    const all = scopeList()
    const cur = scope()
    if (!all.includes(cur)) {
      setScope(all[0] ?? "all")
    }
  })

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  })

  return (
    <box flexDirection="column" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} gap={1}>
      <text fg={props.api.theme.current.text}>
        <b>Token Usage Chart</b>
      </text>
      <text fg={props.api.theme.current.textMuted}>
        window: {mode()} | metric: {kind()} | scope: {scope()} | debug: {debug() ? "on" : "off"} | keys: tab/left/right window, up/down metric, s scope, r/ctrl+r/f5 refresh, d debug, esc back
      </text>
      <Show when={lastRefreshAt()}>
        {(ts) => (
          <text fg={props.api.theme.current.textMuted}>last refresh: {new Date(ts()).toLocaleTimeString()}</text>
        )}
      </Show>

      <Show when={busy()}>
        <text fg={props.api.theme.current.textMuted}>Loading usage...</text>
      </Show>

      <Show when={err()}>{(item) => <text fg={props.api.theme.current.error}>Error: {item()}</text>}</Show>

      <Show when={!busy() && !err() && view().length === 0}>
        <text fg={props.api.theme.current.textMuted}>No data found.</text>
      </Show>

      <Show when={!busy() && !err() && view().length > 0}>
        <For each={view()}>
          {(item) => (
            <text fg={props.api.theme.current.textMuted} wrapMode="none">
              <Show
                when={kind() === "both"}
                fallback={`${item.label.padEnd(11)} ${bar(item.size)} ${kind() === "cost" ? money.format(item.cost) : fmt(item.tokens)}`}
              >
                {item.label.padEnd(11)} T:{barWith(item.tokenSize, "#")} {fmt(item.tokens)} C:{barWith(item.costSize, "=")} {money.format(item.cost)}
              </Show>
            </text>
          )}
        </For>
      </Show>

      <box flexDirection="row" gap={3}>
        <text fg={props.api.theme.current.textMuted}>total tokens: {fmt(data().total.tokens)}</text>
        <text fg={props.api.theme.current.textMuted}>total cost: {money.format(data().total.cost)}</text>
      </box>

      <Show when={debug() && data().debug.lines.length > 0}>
        <box flexDirection="column" marginTop={1}>
          <text fg={props.api.theme.current.info}>Debug</text>
          <For each={data().debug.lines}>{(line) => <text fg={props.api.theme.current.textMuted}>- {line}</text>}</For>
        </box>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return

  api.route.register([
    {
      name: route,
      render: ({ params }) => <View api={api} back={parseBackTarget(params)} />,
    },
  ])

  api.command.register(() => [
    {
      title: "Token Usage Chart",
      value: "token.usage.chart",
      category: "Plugin",
      slash: {
        name: "token-chart",
      },
      onSelect: () => {
        const current = api.route.current
        const back: BackTarget =
          current.name === "session" &&
          current.params &&
          typeof current.params.sessionID === "string" &&
          current.params.sessionID.length > 0
            ? {
                name: "session",
                params: {
                  sessionID: current.params.sessionID,
                },
              }
            : { name: "home" }

        api.route.navigate(route, { back })
      },
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
