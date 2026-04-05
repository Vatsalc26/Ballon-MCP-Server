# Cline Quickstart

This is the quickest way to try Balloon MCP in Cline.

Current status:

1. `experimental but promising`
2. best used with Balloon's tool-first flows
3. not yet as validated as the VS Code-first path

## 1. Prepare Balloon

From the Balloon repo:

```powershell
npm install
npm run build
npm run verify:balloon:mcp
```

If you want assist mode:

```powershell
npm run balloon:mcp -- --semantic-cara-mode assist --semantic-cara-adapter .\examples\semantic_cara_adapter.example.mjs
```

If you want the simpler deterministic path:

```powershell
npm run balloon:mcp
```

## 2. Add The MCP Server In Cline

Use this example as your starting point:

1. [../examples/cline_mcp_settings.example.json](../examples/cline_mcp_settings.example.json)

Replace:

1. `REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH`

On Windows, prefer a full absolute path.

## 3. Restart And Use A Fresh Chat

After adding or editing the config:

1. restart the MCP server entry in Cline
2. start a fresh chat
3. if tools seem stale, restart the host again

## 4. First Balloon Commands To Try

Use these first:

1. `balloon_run_cycle`
2. `balloon_repair_next_turn`
3. `balloon_compare_benchmark_lanes`

Those avoid depending on prompt routing.

## 5. First Good Test

Run:

1. [../examples/demo_run_cycle_request.json](../examples/demo_run_cycle_request.json)
2. [../examples/demo_compare_benchmark_lanes_request.json](../examples/demo_compare_benchmark_lanes_request.json)

What success looks like:

1. Cline can see the Balloon tools
2. `balloon_run_cycle` returns a real gap report and proxy trickle
3. `balloon_compare_benchmark_lanes` returns baseline, deterministic, assist, and staged lanes

## Notes

If prompt-style flows feel flaky, prefer:

1. `balloon_repair_next_turn`
2. `balloon_review_session_drift`
3. `balloon_compare_benchmark_lanes`

before trying:

1. `balloon/repair-next-turn`
2. `balloon/review-session-drift`
