# Install

## Requirements

1. Node.js `>=24.14.0 <25`
2. npm

## Install

```powershell
npm install
npm run build
```

## Verify

This command is the fastest way to confirm the server is healthy:

```powershell
npm run verify:balloon:mcp
```

## Start The Server

```powershell
npm run balloon:mcp
```

Optional custom data directory:

```powershell
npm run balloon:mcp -- --data-dir .balloon-mcp-demo
```

Optional semantic CARA shadow mode:

```powershell
npm run balloon:mcp -- --semantic-cara-mode shadow
```

Optional semantic CARA assist mode with an adapter:

```powershell
npm run balloon:mcp -- --semantic-cara-mode assist --semantic-cara-adapter .\examples\semantic_cara_adapter.example.mjs
```

Note:

1. shadow mode is the verified smoke-test path today
2. assist mode is implemented and has been verified in a direct local check
3. MCP-hosted assist mode still depends on your host and local permissions allowing child-process execution

## Connect From An MCP Host

See [../examples/claude_desktop_config.example.json](../examples/claude_desktop_config.example.json) for a starting config.

For VS Code, create `.vscode/mcp.json` from [../examples/vscode_mcp.example.json](../examples/vscode_mcp.example.json).

You will usually need to adapt:

1. `cwd`
2. the server path
3. the data directory path

## VS Code Host Test

As of `2026-04-05`, VS Code supports MCP servers through `mcp.json`.

Recommended test flow:

1. open this repo in VS Code
2. run `npm install`
3. run `npm run build`
4. create `.vscode/mcp.json` using the VS Code example
5. use the `MCP: List Servers` command and start `balloon-mcp`
6. confirm trust when VS Code prompts
7. open chat and try `balloon_run_cycle`

If the server starts but tools do not appear, use the MCP output log in VS Code to inspect errors.

If a chat tab was already open before the server became healthy, prefer starting a fresh chat or running `MCP: Reset Cached Tools` before testing. Older chat tabs can keep stale MCP state.

Use the built-in VS Code Chat first. You do not need Cline for the first host test.

## What Success Looks Like

A good first run should give you:

1. a gap report that explains what the latest answer dropped
2. a proxy trickle that applies smaller corrective pressure
3. a suggested next-turn stance that preserves the earlier direction

The server writes Balloon state under folders such as `.balloon-mcp/` or `.balloon-mcp-demo/`. It does not patch your repo by itself.

## Stranger-Style Install Pass

Before public export, do one pass as if you were a new user:

1. open a fresh VS Code window
2. use only the public README and this install guide
3. start the server from `mcp.json`
4. run the first demo without private explanation
5. write down every place where you had to guess

If the install path still depends on private verbal guidance, the public surface is not ready yet.

## First Things To Try

1. `balloon_run_cycle`
2. `balloon/repair-next-turn`
3. `balloon_repair_next_turn`
4. `balloon_semantic_cara_preview`
5. `balloon://sessions/{sessionId}/gaps`

If prompt invocation is inconsistent in your MCP host, prefer `balloon_repair_next_turn` for repeatable demos and benchmark runs.

If you want to experiment with the optional hybrid lane, read [SEMANTIC_CARA.md](./SEMANTIC_CARA.md).
