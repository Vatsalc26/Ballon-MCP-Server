# Roo Code Quickstart

This is the simplest current way to try Balloon MCP in Roo Code.

Current status:

1. `experimental`
2. worth trying
3. not yet as well-validated as VS Code

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

## 2. Add The MCP Server In Roo

Use this example as a starting point:

1. [../examples/roo_mcp.example.json](../examples/roo_mcp.example.json)

Replace:

1. `REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH`

Windows note:

1. prefer absolute paths
2. avoid relying on `${workspaceFolder}`-style variables unless your Roo version supports them cleanly

## 3. Restart And Use A Fresh Chat

After changing the config:

1. restart the Balloon MCP entry
2. start a fresh chat
3. if tools appear stale, restart Roo again

## 4. Best First Balloon Flows

Start with tool-first flows:

1. `balloon_run_cycle`
2. `balloon_repair_next_turn`
3. `balloon_compare_benchmark_lanes`

That gives the best chance of a smooth first pass.

## 5. What To Validate

Your first good Roo run should prove:

1. Balloon tools are visible
2. `balloon_run_cycle` returns gaps and trickle
3. `balloon_compare_benchmark_lanes` returns all 4 lanes

Use these example payloads:

1. [../examples/demo_run_cycle_request.json](../examples/demo_run_cycle_request.json)
2. [../examples/demo_compare_benchmark_lanes_request.json](../examples/demo_compare_benchmark_lanes_request.json)

## Notes

If prompt surfaces feel inconsistent in Roo, prefer the tool versions first and treat prompt routing as a later validation layer.
