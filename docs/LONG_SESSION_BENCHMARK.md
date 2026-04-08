# Long-Session Benchmark

The small 3-scenario pilot is only the start.

This page is for the next question:

Can Balloon stay useful deeper into a session instead of only helping on one short correction?

## If You Want Official Benchmark Input

Use the official SlopCodeBench repository as the source dataset:

1. `https://github.com/SprocketLab/slop-code-bench`

If you download a local snapshot, do not blindly trust the folder name alone.

Verify that the snapshot still contains the expected benchmark markers before using it for Balloon comparisons.

The helper for that is:

```powershell
node dist/verification/verify_slopcodebench_dataset.js --dataset-root "..\\slop-code-bench-main"
```

After the dataset root passes, verify the selected starter problems too:

```powershell
node dist/verification/verify_slopcodebench_starter_suite.js --dataset-root "..\\slop-code-bench-main"
```

That check looks for:

1. the official top-level repo layout
2. README, pyproject, and citation markers
3. benchmark configs, prompts, and problem/test markers
4. whether the dataset is a commit-pinned clone or only a zip-style snapshot

If you want the first recommended real-problem set after verification, use:

1. [SLOPCODEBENCH_STARTER_SUITE.md](./SLOPCODEBENCH_STARTER_SUITE.md)
2. `balloon_describe_slopcode_starter_suite`
3. `balloon_plan_slopcode_starter_benchmark`
4. `balloon_prepare_slopcode_problem`
5. `balloon_prepare_slopcode_live_run_packet`
6. `balloon_prepare_slopcode_live_run_finalize_packet`
7. `balloon_prepare_slopcode_live_run_batch`
8. `balloon_finalize_slopcode_live_run`
9. `balloon_finalize_slopcode_live_run_batch`
10. `balloon_score_benchmark_lanes`

For SCBench starter-suite reruns, the recommended checkpoint numbers are assistant-turn ordinals. Use `checkpointMode: assistant_checkpoint` when you score the whole sequence with `balloon_score_long_session_benchmark`.

## What To Measure

Across a longer session, check whether Balloon keeps:

1. architecture direction
2. protected areas
3. verification obligations
4. bounded next steps
5. acceptable correction tax

## Recommended Session Lengths

Start with:

1. `25` turns
2. `50` turns

Only after those look healthy, move to:

1. `75` turns
2. `100` turns

## Recommended Lanes

Compare:

1. baseline
2. deterministic
3. assist
4. staged

## Recommended Tool

Use `balloon_run_long_session_benchmark` when you want checkpointed long-session comparison in one tool call.

Use `balloon_score_long_session_benchmark` when you want the same checkpoints scored automatically on Balloon's six-dimension scorecard.

Use `balloon_export_slopcode_starter_artifacts` when you want JSON and Markdown summaries written to disk for repo-backed benchmark tracking.

Those artifact exports now include pressure-trace summaries and live-vs-replay evidence coverage, so you can see which starter problems kept rising, which ones settled, and which ones still do not have true live benchmark evidence yet.

Use `balloon_record_slopcode_run_evidence` right after a rerun so the benchmark ledger says whether the run came from a real live LLM host session, a manual replay, a fixture, or a synthetic demo.

Use `balloon_prepare_slopcode_live_run_packet` when you want Balloon to hand you the full host/problem/session checklist before starting the live rerun.

Use `balloon_prepare_slopcode_live_run_finalize_packet` when you want Balloon to hand you a ready-to-paste finalizer JSON shell so you only need to replace the transcript placeholders with the real user/assistant turns.

Use `balloon_prepare_slopcode_live_run_batch` when you want the whole starter-suite rerun pass prepared together instead of one problem at a time.

Use `balloon_finalize_slopcode_live_run` after the real rerun when you want Balloon to score the recommended checkpoint batch, record the run, and export the starter artifact bundle in one step.

Use `balloon_finalize_slopcode_live_run_batch` when you want one shared bundle refreshed after multiple starter problems were completed in separate live sessions.

Use `balloon_summarize_slopcode_run_evidence` or read `balloon://benchmark/slopcode/evidence` before making public benchmark claims.

Suggested starting call:

```text
Use #balloon_run_long_session_benchmark with:

- sessionId: long-bench-25
- checkpoints: [10, 25]
- semanticAdapterPath: .\examples\semantic_cara_adapter.example.mjs
- stageThresholds: [5, 15, 40]

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.
```

That call will return checkpoint batches with:

1. baseline reply
2. deterministic Balloon reply
3. assist Balloon reply
4. staged external Balloon reply
5. checkpoint drift-pressure snapshots so you can see whether pressure is rising or being corrected
6. pressure-conditioned behavior where repeated architecture or verification drift can become persistent focus instead of being treated like isolated misses

If you want the standard six-dimension scorecard immediately after that, run `balloon_score_benchmark_lanes` on the same session.

Suggested scoring call:

```text
Use #balloon_score_long_session_benchmark with:

- sessionId: long-bench-25
- checkpoints: [10, 25]
- semanticAdapterPath: .\examples\semantic_cara_adapter.example.mjs
- stageThresholds: [5, 15, 40]

Return text only.
Do not edit files.
Do not apply patches.
Do not run terminal commands.
```

That call will return:

1. checkpoint-by-checkpoint scorecards
2. aggregate lane totals
3. top-performing lane(s) across the whole long-session batch
4. a pressure-history summary across the checkpoint sequence
5. checkpoint drift-pressure traces that make it easier to say where Balloon re-anchored the session and where pressure stayed stuck

If you want the same signal after normal tool use, inspect:

1. `balloon://sessions/{sessionId}/pressure`

## Recommended Staged Profiles

Try:

1. everyday profile: `5 / 15 / 40`
2. longer benchmark profile: `8 / 25 / 60`

## Example Fixtures

Use these starting fixtures:

1. [../examples/long_session_25_turns.example.json](../examples/long_session_25_turns.example.json)
2. [../examples/long_session_50_turns.example.json](../examples/long_session_50_turns.example.json)
3. [../examples/long_session_benchmark_request.example.json](../examples/long_session_benchmark_request.example.json)
4. [../examples/long_session_score_request.example.json](../examples/long_session_score_request.example.json)
5. [../examples/slopcode_starter_suite_request.example.json](../examples/slopcode_starter_suite_request.example.json)
6. [../examples/slopcode_starter_benchmark_plan_request.example.json](../examples/slopcode_starter_benchmark_plan_request.example.json)
7. [../examples/slopcode_problem_prep_request.example.json](../examples/slopcode_problem_prep_request.example.json)
8. [../examples/benchmark_scorecard_request.example.json](../examples/benchmark_scorecard_request.example.json)
9. [../examples/slopcode_starter_suite_summary_request.example.json](../examples/slopcode_starter_suite_summary_request.example.json)
10. [../examples/slopcode_starter_artifact_export_request.example.json](../examples/slopcode_starter_artifact_export_request.example.json)
11. [../examples/slopcode_live_run_packet_request.example.json](../examples/slopcode_live_run_packet_request.example.json)
12. [../examples/slopcode_live_run_finalize_packet_request.example.json](../examples/slopcode_live_run_finalize_packet_request.example.json)
13. [../examples/slopcode_live_run_batch_request.example.json](../examples/slopcode_live_run_batch_request.example.json)
14. [../examples/slopcode_live_run_finalize_request.example.json](../examples/slopcode_live_run_finalize_request.example.json)
15. [../examples/slopcode_live_run_batch_finalize_request.example.json](../examples/slopcode_live_run_batch_finalize_request.example.json)
16. [../examples/slopcode_run_evidence_request.example.json](../examples/slopcode_run_evidence_request.example.json)
17. [../examples/slopcode_run_evidence_summary_request.example.json](../examples/slopcode_run_evidence_summary_request.example.json)

They are not "official benchmark wins."

They are simply reproducible longer-session starting points.

The first real-problem step after those fixtures is the verified SCBench starter suite, not a claim of benchmark victory.

Those fixtures are not live evidence by default.

If a run was replayed from pasted turns or generated locally, record it that way and do not count it as live benchmark proof.

## What Good Looks Like

A good longer-session Balloon run is not one that produces more text.

It is one that:

1. keeps earlier constraints alive later in the session
2. resists broad refactors when the session asked for bounded changes
3. keeps verification visible
4. avoids paying too much correction tax for weak gains
5. stays easy enough to rerun that contributors can repeat the evidence

## Communication Rule

Use these runs to say:

1. Balloon has a longer-session evaluation path
2. Balloon is being tested beyond tiny three-turn scenarios
3. the project is moving toward trajectory-shaped proof

Do not use them to say:

1. Balloon has already won SlopCodeBench
2. Balloon has solved long-horizon coding in general
