# Host Validation

This page answers a practical question:

How should you validate Balloon in a real MCP host without drifting into undocumented setup folklore?

## Built-In Validation Surfaces

Use these first:

1. `balloon_run_install_diagnostics`
2. `balloon_prepare_host_flow_packet`
3. `balloon_prepare_host_validation_suite`
4. `balloon_record_host_validation_result`
5. `balloon_summarize_host_validation_results`
6. `balloon://hosts/{host}/playbook`
7. `balloon://hosts/{host}/validation-suite`
8. `balloon://hosts/{host}/validation-evidence`

These surfaces are meant to replace ad-hoc verbal guidance.

## Validation Order

The recommended order is:

1. install doctor
2. same-chat tool repair
3. fresh-chat prompt repair
4. fresh-chat prompt review
5. same-chat benchmark compare

That order matters because prompt routing should be tested only after the tool-first path is already healthy.

## Same-Chat Checks

These checks answer:

1. do the Balloon tools stay visible after earlier Balloon calls
2. does the host keep session arguments stable
3. does the tool-first path stay reliable without requiring a restart

Use these first:

1. `balloon_run_cycle`
2. `balloon_repair_next_turn`
3. `balloon_compare_benchmark_lanes`

Good signs:

1. the host does not lose tool visibility mid-chat
2. the repaired reply keeps earlier constraints
3. the benchmark packet still returns all 4 lanes

Bad signs:

1. tools appear stale after earlier calls
2. the host keeps old arguments
3. the repair output ignores the already-seeded session

## Fresh-Chat Checks

These checks answer:

1. can the host route prompt surfaces cleanly
2. do prompt args survive into the new chat
3. does the prompt result stay close to the tool fallback

Use the prompt surfaces only after the tool path is already known-good:

1. `balloon/repair-next-turn`
2. `balloon/review-session-drift`

Good signs:

1. the prompt can be found and invoked with the expected args
2. the prompt result preserves the same core constraints as the tool path
3. the host does not need undocumented nudges to make prompt routing work

Bad signs:

1. the prompt is missing or routed with stale args
2. the prompt result drifts materially from the tool fallback
3. the host only behaves after extra verbal steering outside the docs

## Practical Recommendation

If you only have time for one real validation pass:

1. run `balloon_run_install_diagnostics`
2. run `balloon_prepare_host_validation_suite`
3. follow the case order it returns
4. record where the host needed a restart, a fresh chat, or a tool fallback with `balloon_record_host_validation_result`
5. review the accumulated summary with `balloon_summarize_host_validation_results`

If the host still depends on explanation that is not captured in the built-in suite or public docs, the host path is not ready yet.
