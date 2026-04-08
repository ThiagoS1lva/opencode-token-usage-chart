# @thiagos1lva/opencode-token-usage-chart

An OpenCode TUI plugin that adds a token usage chart view for your sessions.

## Installation

```bash
npm install -g @thiagos1lva/opencode-token-usage-chart
# or
bun add -g @thiagos1lva/opencode-token-usage-chart
```

## Usage

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@thiagos1lva/opencode-token-usage-chart"]
}
```

> Note: in some OpenCode setups, the same config may be stored in `config.json` instead of `opencode.json`.

That's it. OpenCode will load the plugin at startup.

Then open the chart with:

- Slash command: `/token-chart`
- Command palette value: `token.usage.chart`

## How It Works

- Registers a TUI route named `token-usage` and a command `/token-chart`.
- Aggregates usage from assistant messages into chart buckets (`15min`, `30min`, `hour`, `day`, `week`, `month`).
- Supports dynamic scopes: `all`, optional `workspace`, and optional `session`.
- Total tokens are calculated as `input + output + reasoning + cache.read + cache.write`.
- Includes refresh and diagnostics helpers directly in the chart view.

## Requirements

- OpenCode with TUI plugin support

## License

MIT
