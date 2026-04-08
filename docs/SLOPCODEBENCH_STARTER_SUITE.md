# SlopCodeBench Starter Suite

This is the first real dataset-backed Balloon benchmark starter set.

It is not a claim that Balloon has already won SlopCodeBench.

It is the first verified set of real SCBench problems we recommend for repeatable Balloon anti-drift reruns.

## Selected Problems

1. `file_backup`
2. `execution_server`
3. `trajectory_api`

## Why These 3

### `file_backup`

Good for bounded CLI evolution, event-history discipline, and checking whether Balloon resists premature refactors when the spec grows.

### `execution_server`

Good for stateful server growth under timeout, caching, concurrency, and scheduling pressure.

### `trajectory_api`

Good for preserving API boundaries, validation rules, concurrency discipline, and layered feature growth.

## New MCP Surfaces

Use:

1. `balloon_describe_slopcode_starter_suite`
2. `balloon_plan_slopcode_starter_benchmark`
3. `balloon_prepare_slopcode_problem`
4. `balloon_score_benchmark_lanes`
5. `balloon_score_long_session_benchmark`
6. `balloon_prepare_slopcode_live_run_packet`
7. `balloon_prepare_slopcode_live_run_finalize_packet`
8. `balloon_prepare_slopcode_live_run_batch`
9. `balloon_finalize_slopcode_live_run`
10. `balloon_finalize_slopcode_live_run_batch`
11. `balloon_record_slopcode_run_evidence`
12. `balloon_summarize_slopcode_run_evidence`
13. `balloon_summarize_slopcode_starter_suite`
14. `balloon_export_slopcode_starter_artifacts`
15. `balloon://benchmark/slopcode/starter-suite`
16. `balloon://benchmark/slopcode/starter-suite/runbook`
17. `balloon://benchmark/slopcode/live-run-playbook`
18. `balloon://benchmark/slopcode/live-run-batch`
19. `balloon://benchmark/slopcode/evidence`
20. `balloon://benchmark/slopcode/evidence/{problemName}`
21. `balloon://benchmark/slopcode/problems/{problemName}`

## Fast Starter Workflow

1. verify your local snapshot with `verify_slopcodebench_dataset`
2. verify the selected starter problems with `verify_slopcodebench_starter_suite`
3. inspect the suite with `balloon_describe_slopcode_starter_suite`
4. build the runbook with `balloon_plan_slopcode_starter_benchmark`
5. inspect one problem with `balloon_prepare_slopcode_problem`
6. generate the host/problem live packet with `balloon_prepare_slopcode_live_run_packet`
7. generate the ready-to-paste finalizer shell with `balloon_prepare_slopcode_live_run_finalize_packet`
8. if you want the whole pass at once, generate the batch packet with `balloon_prepare_slopcode_live_run_batch`
9. run the checkpoint sequence in your host
10. compare lanes with `balloon_compare_benchmark_lanes`
11. score them with `balloon_score_benchmark_lanes`
12. if you stretch the same session across multiple checkpoints, score the whole checkpoint batch with `balloon_score_long_session_benchmark`
13. for SCBench starter sequences, treat those checkpoint numbers as assistant-turn ordinals and set `checkpointMode: assistant_checkpoint`
14. preferably finalize the rerun in one pass with `balloon_finalize_slopcode_live_run`
15. when several starter problems are done, refresh the shared bundle with `balloon_finalize_slopcode_live_run_batch`
16. if you need the manual path, record whether the run was live, replayed, fixture-based, or synthetic with `balloon_record_slopcode_run_evidence`
17. after several problem sessions exist, roll them up with `balloon_summarize_slopcode_run_evidence` and `balloon_summarize_slopcode_starter_suite`
18. export the suite bundle with `balloon_export_slopcode_starter_artifacts`

## Recommended First Order

1. `file_backup`
2. `execution_server`
3. `trajectory_api`

## Suggested Rule

For the first checkpoint-sequence runs:

1. keep `forceStageCount: 3`
2. treat the recommended checkpoint numbers as assistant-turn ordinals, not raw turn counts
3. set `checkpointMode: assistant_checkpoint` whenever you score a whole checkpoint batch
4. score the opening, middle, and late checkpoint of each problem
5. keep the same score dimensions every time:
6. constraint preservation
7. architecture preservation
8. verification carry-forward
9. omission recovery
10. boundedness
11. clarity
12. export JSON and Markdown artifacts for each rerun
13. explicitly mark replayed or synthetic runs as non-live evidence
14. keep claims modest and reproducible

## Why The New Runbook Matters

The starter suite now has both:

1. a runbook tool
2. a scorecard tool
3. a long-session score tool
4. an evidence ledger that separates live runs from replay/demo runs
5. a suite summary tool
6. an artifact export tool

That export bundle now carries both score/pressure data and evidence coverage, so the summary itself can show whether a problem has true live reruns yet.

It also follows the latest evidence-backed session id for a problem, so host-prefixed live reruns do not fall out of the export path just because the session id differs from the default recommendation.

So contributors can move from dataset verification to repeatable scoring without inventing their own process each time.

## Claim Boundary

Say:

1. Balloon has a verified SCBench starter-suite path
2. Balloon is being tested on real benchmark problem sequences

Do not say:

1. Balloon has already beaten SlopCodeBench
2. Balloon has solved long-horizon coding in general
