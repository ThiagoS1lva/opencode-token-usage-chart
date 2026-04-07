# opencode-token-usage-chart

OpenCode TUI plugin that adds a token usage chart screen.

## Install from npm

1. Publish this package to npm (or use your own forked package name).
2. Add it to your OpenCode `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "opencode-token-usage-chart",
      {
        "enabled": true
      }
    ]
  ]
}
```

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

Package name `opencode-token-usage-chart` is currently available on npm.
