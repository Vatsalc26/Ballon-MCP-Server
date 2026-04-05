# Host Compatibility

This page answers a simple question:

Where should you try Balloon MCP first, and where is it still more experimental?

## Current Host Readiness

### Tier 1: Recommended First

#### VS Code built-in MCP

Status: `best current path`

Why:

1. this is the host path Balloon has been exercised in most directly
2. the install path is documented
3. the tool-first fallback flows are already practical here

Use this first if you want the least friction.

### Tier 2: Promising But More Experimental

#### Cline

Status: `promising`

Why:

1. Cline has a real MCP configuration surface
2. Balloon's tool-first flows should translate well
3. host behavior still needs more day-to-day validation than the VS Code-first path

Use the example file:

1. [../examples/cline_mcp_settings.example.json](../examples/cline_mcp_settings.example.json)
2. [CLINE_QUICKSTART.md](./CLINE_QUICKSTART.md)

#### Roo Code

Status: `experimental`

Why:

1. Roo is a meaningful MCP target for Balloon's product vision
2. local MCP configuration behavior has changed across Roo releases
3. Balloon has not yet had the same level of host-specific validation here as in VS Code

Use the example file as a starting point only:

1. [../examples/roo_mcp.example.json](../examples/roo_mcp.example.json)
2. [ROO_CODE_QUICKSTART.md](./ROO_CODE_QUICKSTART.md)

Prefer:

1. absolute paths on Windows
2. a fresh chat after server changes
3. tool-first Balloon flows before prompt-heavy flows

### Tier 3: Generic / Manual MCP Hosts

#### Claude Desktop-style or other `mcpServers` JSON hosts

Status: `manual but workable`

Use:

1. [../examples/claude_desktop_config.example.json](../examples/claude_desktop_config.example.json)

These hosts can work well for:

1. tool access
2. resource reads
3. drift review

But you may need to adapt:

1. `cwd`
2. path handling
3. command quoting
4. restart behavior

## Best Balloon Flows By Host Maturity

### Most Reliable First

Use these first in any host:

1. `balloon_run_cycle`
2. `balloon_repair_next_turn`
3. `balloon_review_session_drift`
4. `balloon_compare_benchmark_lanes`

These are better first tests because they avoid depending on prompt routing.

### More Host-Sensitive

These surfaces are still more dependent on host behavior:

1. `balloon/repair-next-turn`
2. `balloon/review-session-drift`

If they feel flaky in your host, fall back to the tool versions.

## Windows Notes

On Windows, prefer:

1. absolute paths in experimental hosts
2. restarting the MCP server after config changes
3. a fresh chat after restarting the server

If tools seem stale:

1. restart the MCP server
2. reset cached MCP tools if your host supports that
3. start a fresh chat

## Current Recommendation

If you want the shortest path to a good first experience:

1. start in VS Code
2. validate `balloon_run_cycle`
3. validate `balloon_compare_benchmark_lanes`
4. then try Cline or Roo with the example configs
