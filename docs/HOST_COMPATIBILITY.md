# Host Compatibility

This page answers a simple question:

Where should you try Balloon MCP first, and where is it still more experimental?

## Built-In Host Help

If you want Balloon itself to generate or check the config:

1. use `balloon_prepare_host_setup_packet` for a host-specific config snippet
2. use `balloon_validate_host_setup` against a config file or inline JSON
3. use `balloon_run_install_diagnostics` for a stricter install-doctor pass
4. use `balloon_prepare_host_flow_packet` for the safest flow-specific invocation path
5. read `balloon://hosts/matrix` for the current host tiers
6. read `balloon://hosts/{host}` for host-specific caveats and restart guidance
7. read `balloon://hosts/{host}/playbook` for the built-in host flow playbook
8. use `balloon_prepare_host_validation_suite` or read `balloon://hosts/{host}/validation-suite` for the same-chat and fresh-chat validation order
9. use `balloon_record_host_validation_result`, `balloon_summarize_host_validation_results`, or `balloon://hosts/{host}/validation-evidence` to keep a real evidence trail

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
5. `balloon_prepare_host_setup_packet`
6. `balloon_validate_host_setup`
7. `balloon_run_install_diagnostics`
8. `balloon_prepare_host_flow_packet`
9. `balloon_prepare_host_validation_suite`

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
2. generate the config with `balloon_prepare_host_setup_packet`
3. run `balloon_run_install_diagnostics`
4. read `balloon://hosts/vscode/playbook` or run `balloon_prepare_host_flow_packet`
5. read `balloon://hosts/vscode/validation-suite` or run `balloon_prepare_host_validation_suite`
6. validate `balloon_run_cycle`
7. validate `balloon_compare_benchmark_lanes`
8. then try Cline or Roo with the example configs
