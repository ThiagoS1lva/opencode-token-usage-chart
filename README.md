# opencode-token-usage-chart

OpenCode TUI plugin that adds a token usage chart screen.

## Install from npm

Package name:

`@thiagos1lva/opencode-token-usage-chart`

### Global install (all projects)

Add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@thiagos1lva/opencode-token-usage-chart"
  ]
}
```

### Local install (single repo)

Add to `<repo>/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@thiagos1lva/opencode-token-usage-chart"
  ]
}
```

OpenCode installs npm plugins automatically at startup.

## Use

- Run slash command `/token-chart`.
- Or open command palette and run `token.usage.chart`.

## Local development

This repo also works as a local plugin via `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "./plugins/tui-token-usage.tsx",
      {
        "enabled": true
      }
    ]
  ]
}
```

## Publish checklist

```bash
npm login
npm pack --dry-run
npm publish --access public
```
