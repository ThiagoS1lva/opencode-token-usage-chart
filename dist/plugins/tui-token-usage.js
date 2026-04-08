import { effect as _$effect } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
/** @jsxImportSource @opentui/solid */
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
const id = "tui-token-usage";
const route = "token-usage";
const gran = ["15min", "30min", "hour", "day", "week", "month"];
const metr = ["tokens", "cost", "both"];
const GLOBAL_CALL_OPTIONS = {
  headers: {
    "x-opencode-directory": "",
    "x-opencode-workspace": ""
  }
};
const sessionAggregateCache = new Map();
const CACHE_VERSION = "v6";
function isFastMode(mode) {
  return mode === "15min" || mode === "30min" || mode === "hour";
}
function messageLimit(mode) {
  if (mode === "15min") return 400;
  if (mode === "30min") return 500;
  if (mode === "hour") return 800;
  if (mode === "day") return 2000;
  if (mode === "week") return 4000;
  return 6000;
}
function sessionListLimit(mode) {
  return isFastMode(mode) ? 5000 : 20000;
}
function count(input) {
  if (input === "15min") return 48;
  if (input === "30min") return 48;
  if (input === "hour") return 24;
  if (input === "day") return 30;
  if (input === "week") return 20;
  return 12;
}
function start(ts, mode) {
  const d = new Date(ts);
  if (mode === "15min") {
    const minute = d.getMinutes();
    d.setMinutes(minute - minute % 15, 0, 0);
    return d.getTime();
  }
  if (mode === "30min") {
    const minute = d.getMinutes();
    d.setMinutes(minute - minute % 30, 0, 0);
    return d.getTime();
  }
  if (mode === "hour") {
    d.setMinutes(0, 0, 0);
    return d.getTime();
  }
  if (mode === "day") {
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (mode === "week") {
    d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}
function label(ts, mode) {
  const d = new Date(ts);
  if (mode === "15min" || mode === "30min") {
    return d.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit"
    });
  }
  if (mode === "hour") return d.toLocaleString(undefined, {
    hour: "2-digit",
    day: "2-digit",
    month: "2-digit"
  });
  if (mode === "day") return d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit"
  });
  if (mode === "week") {
    const w = week(d);
    return `W${w.number} ${w.year}`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    year: "2-digit"
  });
}
function week(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const y = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return {
    number: Math.ceil(((x.getTime() - y.getTime()) / 86400000 + 1) / 7),
    year: x.getUTCFullYear()
  };
}
function add(ts, mode, amount) {
  const d = new Date(ts);
  if (mode === "15min") {
    d.setMinutes(d.getMinutes() + amount * 15);
    return d.getTime();
  }
  if (mode === "30min") {
    d.setMinutes(d.getMinutes() + amount * 30);
    return d.getTime();
  }
  if (mode === "hour") {
    d.setHours(d.getHours() + amount);
    return d.getTime();
  }
  if (mode === "day") {
    d.setDate(d.getDate() + amount);
    return d.getTime();
  }
  if (mode === "week") {
    d.setDate(d.getDate() + amount * 7);
    return d.getTime();
  }
  d.setMonth(d.getMonth() + amount);
  return d.getTime();
}
function buildRows(mode, now = Date.now()) {
  const n = count(mode);
  const end = start(now, mode);
  const first = add(end, mode, -(n - 1));
  return Array.from({
    length: n
  }, (_, i) => {
    const key = add(first, mode, i);
    return {
      key,
      label: label(key, mode),
      tokens: 0,
      cost: 0
    };
  });
}
function tok(msg) {
  return msg.input + msg.output + msg.reasoning + msg.cache.read + msg.cache.write;
}
function sessionStamp(session) {
  if (!session || typeof session !== "object") return "";
  const value = session;
  const id = typeof value.id === "string" ? value.id : "";
  const updated = typeof value.time?.updated === "number" ? value.time.updated : undefined;
  const created = typeof value.time?.created === "number" ? value.time.created : undefined;
  const version = typeof value.version === "string" ? value.version : "";
  return `${id}:${updated ?? created ?? ""}:${version}`;
}
async function aggregateSession(client, sessionID, directory, stamp, mode, range, options) {
  const key = `${directory ?? "default"}:${sessionID}:${mode}:${range.start}:${range.end}`;
  const cached = sessionAggregateCache.get(key);
  if (cached && cached.stamp === stamp) {
    return {
      ...cached,
      stats: {
        ...cached.stats,
        cached: true
      }
    };
  }
  if (options.shouldStop?.()) {
    return {
      stamp,
      bins: new Map(),
      total: {
        tokens: 0,
        cost: 0
      },
      stats: {
        messages: 0,
        assistant: 0,
        inRange: 0,
        cached: false
      }
    };
  }
  let messageError;
  const messages = await client.session.messages({
    sessionID,
    directory,
    limit: messageLimit(mode)
  }, GLOBAL_CALL_OPTIONS).then(x => x.data ?? []).catch(error => {
    messageError = error instanceof Error ? error.message : String(error);
    return [];
  });
  const bins = new Map();
  let total = {
    tokens: 0,
    cost: 0
  };
  let assistantCount = 0;
  let inRangeCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (options.shouldStop?.()) break;
    const info = messages[i].info;
    if (info.role !== "assistant") continue;
    assistantCount++;
    const created = info.time.created;
    if (created >= range.end) continue;
    if (created < range.start) continue;
    inRangeCount++;
    const bucket = start(created, mode);
    const value = bins.get(bucket) ?? {
      tokens: 0,
      cost: 0
    };
    const tokens = tok(info.tokens);
    value.tokens += tokens;
    value.cost += info.cost;
    bins.set(bucket, value);
    total.tokens += tokens;
    total.cost += info.cost;
  }
  const out = {
    stamp,
    bins,
    total,
    stats: {
      messages: messages.length,
      assistant: assistantCount,
      inRange: inRangeCount,
      cached: false,
      error: messageError
    }
  };
  sessionAggregateCache.set(key, out);
  if (sessionAggregateCache.size > 500) {
    const oldest = sessionAggregateCache.keys().next().value;
    if (oldest) sessionAggregateCache.delete(oldest);
  }
  return out;
}
async function load(api, mode, scope, ref, options = {}) {
  const debugLines = [];
  const apiWithScopes = api;
  const workspaceIDs = Array.from(new Set((apiWithScopes.state?.workspace?.list?.() ?? []).map(item => item?.id).filter(item => typeof item === "string" && item.length > 0)));
  const allScopeRef = workspaceIDs.length > 0 ? `all:${workspaceIDs.sort().join(",")}` : "all";
  const scopeRef = scope === "session" ? ref.sessionID ?? "none" : scope === "workspace" ? ref.workspaceID ?? "none" : "all";
  const key = `token-usage-cache:${CACHE_VERSION}:${mode}:${scope}:${scope === "all" ? allScopeRef : scopeRef}`;
  const hit = api.kv.get(key, undefined);
  if (!options.force && hit && Date.now() - hit.time < 5 * 60 * 1000) {
    return {
      ...hit.data,
      debug: {
        lines: [...(hit.data.debug?.lines ?? []), `cache hit key=${key}`, `cache age ms=${Date.now() - hit.time}`]
      }
    };
  }
  const rows = buildRows(mode);
  const idx = new Map(rows.map((item, i) => [item.key, i]));
  const range = {
    start: rows[0]?.key ?? 0,
    end: add(rows[rows.length - 1]?.key ?? 0, mode, 1)
  };
  debugLines.push(`cache miss key=${key}`);
  debugLines.push(`scope=${scope} mode=${mode}`);
  debugLines.push(`workspace ids=${workspaceIDs.length}`);
  debugLines.push(`window start=${new Date(range.start).toISOString()} end=${new Date(range.end).toISOString()}`);
  const clientSources = [];
  if (scope === "workspace") {
    if (ref.workspaceID && apiWithScopes.scopedClient) {
      clientSources.push({
        key: `workspace:${ref.workspaceID}`,
        client: apiWithScopes.scopedClient(ref.workspaceID)
      });
    } else {
      clientSources.push({
        key: "workspace:default",
        client: api.client
      });
    }
  } else if (scope === "all") {
    clientSources.push({
      key: "all:default",
      client: api.client
    });
    if (apiWithScopes.scopedClient) {
      workspaceIDs.forEach(workspaceID => {
        clientSources.push({
          key: `all:${workspaceID}`,
          client: apiWithScopes.scopedClient?.(workspaceID) ?? api.client
        });
      });
    }
  } else {
    clientSources.push({
      key: "session",
      client: api.client
    });
  }
  debugLines.push(`client sources=${clientSources.map(item => item.key).join(",")}`);
  let sessions = [];
  if (scope === "session") {
    if (!ref.sessionID) {
      return {
        rows,
        total: {
          tokens: 0,
          cost: 0
        },
        debug: {
          lines: [...debugLines, "missing sessionID for session scope"]
        }
      };
    }
    sessions = [{
      id: ref.sessionID,
      stamp: ref.sessionID,
      client: api.client,
      directory: undefined
    }];
  } else {
    const dedup = new Map();
    const globalList = await api.client.session.list({
      limit: sessionListLimit(mode)
    }, GLOBAL_CALL_OPTIONS).then(x => x.data ?? []).catch(() => []);
    debugLines.push(`sessions from global override: ${globalList.length}`);
    globalList.forEach(item => {
      if (!item?.id) return;
      if (dedup.has(item.id)) return;
      dedup.set(item.id, {
        id: item.id,
        stamp: sessionStamp(item) || item.id,
        client: api.client,
        directory: undefined
      });
    });
    const projects = await api.client.project.list(undefined, GLOBAL_CALL_OPTIONS).then(x => x.data ?? []).catch(() => []);
    debugLines.push(`projects discovered: ${projects.length}`);
    for (const project of projects) {
      if (!project?.worktree) continue;
      const list = await api.client.session.list({
        directory: project.worktree,
        limit: sessionListLimit(mode)
      }, GLOBAL_CALL_OPTIONS).then(x => x.data ?? []).catch(() => []);
      debugLines.push(`sessions from project ${project.worktree}: ${list.length}`);
      list.forEach(item => {
        if (!item?.id) return;
        if (dedup.has(item.id)) return;
        dedup.set(item.id, {
          id: item.id,
          stamp: sessionStamp(item) || item.id,
          client: api.client,
          directory: project.worktree
        });
      });
    }
    for (const source of clientSources) {
      if (options.shouldStop?.()) break;
      const list = await source.client.session.list({
        limit: sessionListLimit(mode)
      }, GLOBAL_CALL_OPTIONS).then(x => x.data ?? []).catch(() => []);
      debugLines.push(`sessions from ${source.key}: ${list.length}`);
      list.forEach(item => {
        if (!item?.id) return;
        if (dedup.has(item.id)) return;
        dedup.set(item.id, {
          id: item.id,
          stamp: sessionStamp(item) || item.id,
          client: source.client,
          directory: undefined
        });
      });
    }
    sessions = Array.from(dedup.values());
  }
  debugLines.push(`dedup sessions=${sessions.length}`);
  const size = isFastMode(mode) ? 6 : 10;
  let total = {
    tokens: 0,
    cost: 0
  };
  let totalMessagesScanned = 0;
  let totalAssistantMessages = 0;
  let totalInRangeMessages = 0;
  let cachedSessionCount = 0;
  let sessionFetchErrors = 0;
  for (let i = 0; i < sessions.length; i += size) {
    if (options.shouldStop?.()) break;
    const part = sessions.slice(i, i + size);
    const packs = await Promise.all(part.map(session => aggregateSession(session.client, session.id, session.directory, session.stamp, mode, range, options).catch(() => ({
      stamp: session.stamp,
      bins: new Map(),
      total: {
        tokens: 0,
        cost: 0
      },
      stats: {
        messages: 0,
        assistant: 0,
        inRange: 0,
        cached: false,
        error: "aggregateSession failed"
      }
    }))));
    packs.forEach(pack => {
      pack.bins.forEach((value, bucket) => {
        const rowIndex = idx.get(bucket);
        if (rowIndex === undefined) return;
        rows[rowIndex].tokens += value.tokens;
        rows[rowIndex].cost += value.cost;
      });
      total.tokens += pack.total.tokens;
      total.cost += pack.total.cost;
      totalMessagesScanned += pack.stats.messages;
      totalAssistantMessages += pack.stats.assistant;
      totalInRangeMessages += pack.stats.inRange;
      if (pack.stats.cached) cachedSessionCount++;
      if (pack.stats.error) sessionFetchErrors++;
    });
  }
  const rowsWithData = rows.reduce((count, row) => row.tokens > 0 || row.cost > 0 ? count + 1 : count, 0);
  debugLines.push(`messages scanned=${totalMessagesScanned}`);
  debugLines.push(`assistant messages=${totalAssistantMessages}`);
  debugLines.push(`assistant in window=${totalInRangeMessages}`);
  debugLines.push(`session cache hits=${cachedSessionCount}`);
  debugLines.push(`session fetch errors=${sessionFetchErrors}`);
  debugLines.push(`rows with data=${rowsWithData}/${rows.length}`);
  debugLines.push(`total tokens=${Math.round(total.tokens)} total cost=${total.cost.toFixed(4)}`);
  const out = {
    rows,
    total,
    debug: {
      lines: debugLines
    }
  };
  api.kv.set(key, {
    time: Date.now(),
    data: out
  });
  return out;
}
function fmt(input) {
  if (input >= 1000000) return `${(input / 1000000).toFixed(1)}M`;
  if (input >= 1000) return `${(input / 1000).toFixed(1)}K`;
  return `${Math.round(input)}`;
}
function bar(size) {
  if (size <= 0) return "";
  return "#".repeat(size);
}
function barWith(size, char) {
  if (size <= 0) return "";
  return char.repeat(size);
}
function next(all, cur, dir) {
  const i = all.indexOf(cur);
  if (i === -1) return all[0];
  const len = all.length;
  return all[(i + dir + len) % len];
}
function parseBackTarget(input) {
  if (!input || typeof input !== "object") return {
    name: "home"
  };
  const data = input;
  if (!data.back || typeof data.back !== "object") return {
    name: "home"
  };
  const back = data.back;
  if (back.name === "session") {
    const params = back.params;
    if (params && typeof params.sessionID === "string" && params.sessionID.length > 0) {
      return {
        name: "session",
        params: {
          sessionID: params.sessionID
        }
      };
    }
  }
  return {
    name: "home"
  };
}
function View(props) {
  const dim = useTerminalDimensions();
  const [mode, setMode] = createSignal("day");
  const [kind, setKind] = createSignal("tokens");
  const [scope, setScope] = createSignal(props.back.name === "session" ? "session" : "all");
  const [debug, setDebug] = createSignal(false);
  const [busy, setBusy] = createSignal(true);
  const [err, setErr] = createSignal();
  const [data, setData] = createSignal({
    rows: [],
    total: {
      tokens: 0,
      cost: 0
    },
    debug: {
      lines: []
    }
  });
  const [lastRefreshAt, setLastRefreshAt] = createSignal();
  let requestID = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const workspaceID = () => {
    const apiWithWorkspace = props.api;
    return apiWithWorkspace.workspace?.current?.();
  };
  const scopeList = createMemo(() => {
    const out = ["all"];
    if (workspaceID()) out.push("workspace");
    if (props.back.name === "session") out.push("session");
    return out;
  });
  const pull = (force = false) => {
    const id = ++requestID;
    setBusy(true);
    setErr(undefined);
    load(props.api, mode(), scope(), {
      sessionID: props.back.name === "session" ? props.back.params.sessionID : undefined,
      workspaceID: workspaceID()
    }, {
      force,
      shouldStop: () => disposed || id !== requestID || props.api.route.current.name !== route
    }).then(value => {
      if (disposed || id !== requestID) return;
      setData(value);
      setLastRefreshAt(Date.now());
    }).catch(e => {
      if (disposed || id !== requestID) return;
      setErr(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (disposed || id !== requestID) return;
      setBusy(false);
    });
  };
  const view = createMemo(() => {
    const rows = data().rows;
    const maxTokens = rows.reduce((acc, item) => Math.max(acc, item.tokens), 0);
    const maxCost = rows.reduce((acc, item) => Math.max(acc, item.cost), 0);
    const both = kind() === "both";
    const width = both ? Math.max(8, Math.floor(dim().width * 0.18)) : Math.max(12, Math.floor(dim().width * 0.38));
    return rows.map(item => {
      const tokenSize = maxTokens <= 0 ? 0 : Math.max(1, Math.round(item.tokens / maxTokens * width));
      const costSize = maxCost <= 0 ? 0 : Math.max(1, Math.round(item.cost / maxCost * width));
      const size = kind() === "cost" ? costSize : kind() === "tokens" ? tokenSize : 0;
      return {
        ...item,
        size,
        tokenSize,
        costSize
      };
    });
  });
  useKeyboard(evt => {
    if (props.api.route.current.name !== route) return;
    const key = (evt.name ?? "").toLowerCase();
    if (evt.name === "escape") {
      evt.preventDefault();
      evt.stopPropagation();
      if (props.back.name === "session") {
        props.api.route.navigate("session", props.back.params);
      } else {
        props.api.route.navigate("home");
      }
      return;
    }
    if (key === "r" || key === "f5" || evt.ctrl && key === "r") {
      evt.preventDefault();
      evt.stopPropagation();
      pull(true);
      return;
    }
    if (evt.name === "d") {
      evt.preventDefault();
      evt.stopPropagation();
      setDebug(value => !value);
      return;
    }
    if (evt.name === "s") {
      evt.preventDefault();
      evt.stopPropagation();
      setScope(x => next(scopeList(), x, 1));
      return;
    }
    if (evt.name === "tab" || evt.name === "right" || evt.name === "l") {
      evt.preventDefault();
      evt.stopPropagation();
      setMode(x => next(gran, x, 1));
      return;
    }
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault();
      evt.stopPropagation();
      setMode(x => next(gran, x, -1));
      return;
    }
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault();
      evt.stopPropagation();
      setKind(x => next(metr, x, 1));
      return;
    }
    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault();
      evt.stopPropagation();
      setKind(x => next(metr, x, -1));
      return;
    }
  });
  createEffect(() => {
    mode();
    scope();
    pull();
  });
  createEffect(() => {
    const all = scopeList();
    const cur = scope();
    if (!all.includes(cur)) {
      setScope(all[0] ?? "all");
    }
  });
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  });
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$3 = _$createElement("b"),
      _el$5 = _$createElement("text"),
      _el$6 = _$createTextNode(`window: `),
      _el$7 = _$createTextNode(` | metric: `),
      _el$8 = _$createTextNode(` | scope: `),
      _el$9 = _$createTextNode(` | debug: `),
      _el$0 = _$createTextNode(` | keys: tab/left/right window, up/down metric, s scope, r/ctrl+r/f5 refresh, d debug, esc back`),
      _el$13 = _$createElement("box"),
      _el$14 = _$createElement("text"),
      _el$15 = _$createTextNode(`total tokens: `),
      _el$16 = _$createElement("text"),
      _el$17 = _$createTextNode(`total cost: `);
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$5);
    _$insertNode(_el$, _el$13);
    _$setProp(_el$, "flexDirection", "column");
    _$setProp(_el$, "paddingLeft", 2);
    _$setProp(_el$, "paddingRight", 2);
    _$setProp(_el$, "paddingTop", 1);
    _$setProp(_el$, "paddingBottom", 1);
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _el$3);
    _$insertNode(_el$3, _$createTextNode(`Token Usage Chart`));
    _$insertNode(_el$5, _el$6);
    _$insertNode(_el$5, _el$7);
    _$insertNode(_el$5, _el$8);
    _$insertNode(_el$5, _el$9);
    _$insertNode(_el$5, _el$0);
    _$insert(_el$5, mode, _el$7);
    _$insert(_el$5, kind, _el$8);
    _$insert(_el$5, scope, _el$9);
    _$insert(_el$5, () => debug() ? "on" : "off", _el$0);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return lastRefreshAt();
      },
      children: ts => (() => {
        var _el$21 = _$createElement("text"),
          _el$22 = _$createTextNode(`last refresh: `);
        _$insertNode(_el$21, _el$22);
        _$insert(_el$21, () => new Date(ts()).toLocaleTimeString(), null);
        _$effect(_$p => _$setProp(_el$21, "fg", props.api.theme.current.textMuted, _$p));
        return _el$21;
      })()
    }), _el$13);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return busy();
      },
      get children() {
        var _el$1 = _$createElement("text");
        _$insertNode(_el$1, _$createTextNode(`Loading usage...`));
        _$effect(_$p => _$setProp(_el$1, "fg", props.api.theme.current.textMuted, _$p));
        return _el$1;
      }
    }), _el$13);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return err();
      },
      children: item => (() => {
        var _el$23 = _$createElement("text"),
          _el$24 = _$createTextNode(`Error: `);
        _$insertNode(_el$23, _el$24);
        _$insert(_el$23, item, null);
        _$effect(_$p => _$setProp(_el$23, "fg", props.api.theme.current.error, _$p));
        return _el$23;
      })()
    }), _el$13);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!(!busy() && !err()))() && view().length === 0;
      },
      get children() {
        var _el$11 = _$createElement("text");
        _$insertNode(_el$11, _$createTextNode(`No data found.`));
        _$effect(_$p => _$setProp(_el$11, "fg", props.api.theme.current.textMuted, _$p));
        return _el$11;
      }
    }), _el$13);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!(!busy() && !err()))() && view().length > 0;
      },
      get children() {
        return _$createComponent(For, {
          get each() {
            return view();
          },
          children: item => (() => {
            var _el$25 = _$createElement("text");
            _$setProp(_el$25, "wrapMode", "none");
            _$insert(_el$25, _$createComponent(Show, {
              get when() {
                return kind() === "both";
              },
              get fallback() {
                return `${item.label.padEnd(11)} ${bar(item.size)} ${kind() === "cost" ? money.format(item.cost) : fmt(item.tokens)}`;
              },
              get children() {
                return [_$memo(() => item.label.padEnd(11)), " T:", _$memo(() => barWith(item.tokenSize, "#")), " ", _$memo(() => fmt(item.tokens)), " C:", _$memo(() => barWith(item.costSize, "=")), " ", _$memo(() => money.format(item.cost))];
              }
            }));
            _$effect(_$p => _$setProp(_el$25, "fg", props.api.theme.current.textMuted, _$p));
            return _el$25;
          })()
        });
      }
    }), _el$13);
    _$insertNode(_el$13, _el$14);
    _$insertNode(_el$13, _el$16);
    _$setProp(_el$13, "flexDirection", "row");
    _$setProp(_el$13, "gap", 3);
    _$insertNode(_el$14, _el$15);
    _$insert(_el$14, () => fmt(data().total.tokens), null);
    _$insertNode(_el$16, _el$17);
    _$insert(_el$16, () => money.format(data().total.cost), null);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return _$memo(() => !!debug())() && data().debug.lines.length > 0;
      },
      get children() {
        var _el$18 = _$createElement("box"),
          _el$19 = _$createElement("text");
        _$insertNode(_el$18, _el$19);
        _$setProp(_el$18, "flexDirection", "column");
        _$setProp(_el$18, "marginTop", 1);
        _$insertNode(_el$19, _$createTextNode(`Debug`));
        _$insert(_el$18, _$createComponent(For, {
          get each() {
            return data().debug.lines;
          },
          children: line => (() => {
            var _el$26 = _$createElement("text"),
              _el$27 = _$createTextNode(`- `);
            _$insertNode(_el$26, _el$27);
            _$insert(_el$26, line, null);
            _$effect(_$p => _$setProp(_el$26, "fg", props.api.theme.current.textMuted, _$p));
            return _el$26;
          })()
        }), null);
        _$effect(_$p => _$setProp(_el$19, "fg", props.api.theme.current.info, _$p));
        return _el$18;
      }
    }), null);
    _$effect(_p$ => {
      var _v$ = props.api.theme.current.text,
        _v$2 = props.api.theme.current.textMuted,
        _v$3 = props.api.theme.current.textMuted,
        _v$4 = props.api.theme.current.textMuted;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$14, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$16, "fg", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}
const tui = async (api, options) => {
  if (options?.enabled === false) return;
  api.route.register([{
    name: route,
    render: ({
      params
    }) => _$createComponent(View, {
      api: api,
      get back() {
        return parseBackTarget(params);
      }
    })
  }]);
  api.command.register(() => [{
    title: "Token Usage Chart",
    value: "token.usage.chart",
    category: "Plugin",
    slash: {
      name: "token-chart"
    },
    onSelect: () => {
      const current = api.route.current;
      const back = current.name === "session" && current.params && typeof current.params.sessionID === "string" && current.params.sessionID.length > 0 ? {
        name: "session",
        params: {
          sessionID: current.params.sessionID
        }
      } : {
        name: "home"
      };
      api.route.navigate(route, {
        back
      });
    }
  }]);
};
const plugin = {
  id,
  tui
};
export default plugin;
