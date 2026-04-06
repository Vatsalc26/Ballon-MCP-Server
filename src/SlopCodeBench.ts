import fs from "node:fs"
import path from "node:path"

import type {
	BalloonBenchmarkScoreDimension,
	SlopCodeDatasetStatus,
	SlopCodeStarterBenchmarkPlan,
	SlopCodeStarterBenchmarkProblemPlan,
	SlopCodeProblemPreparation,
	SlopCodeStarterSuiteEntry,
	SlopCodeStarterSuiteResult,
} from "./types"

type StarterSuiteSeed = {
	problemName: string
	category: string
	difficulty: string
	checkpointCount: number
	entryFile: string
	recommendedCheckpointBatch: number[]
	recommendedForceStageCount: number
	recommendedLongSessionThresholds: number[]
	antiSlopSignals: string[]
	rationale: string
	openingPressure: string
	closingPressure: string
}

const STARTER_SUITE_NAME = "Balloon SlopCodeBench Starter Suite"

const STARTER_SUITE_SCORE_DIMENSIONS: BalloonBenchmarkScoreDimension[] = [
	{
		key: "constraint_preservation",
		label: "Constraint preservation",
		description: "Keeps explicit constraints, protected areas, and other hard boundaries alive.",
	},
	{
		key: "architecture_preservation",
		label: "Architecture preservation",
		description: "Avoids broad rewrites and stays aligned to the requested architectural direction.",
	},
	{
		key: "verification_carry_forward",
		label: "Verification carry-forward",
		description: "Keeps tests and other verification obligations visible in the corrected reply.",
	},
	{
		key: "omission_recovery",
		label: "Omission recovery",
		description: "Recovers hidden requirements or dropped follow-on work instead of only polishing tone.",
	},
	{
		key: "boundedness",
		label: "Boundedness",
		description: "Narrows the next step to the smallest safe change instead of widening scope.",
	},
	{
		key: "clarity",
		label: "Clarity",
		description: "Communicates the correction cleanly enough that a maintainer can act on it fast.",
	},
]

const STARTER_SUITE_SEEDS: StarterSuiteSeed[] = [
	{
		problemName: "file_backup",
		category: "file-systems",
		difficulty: "Medium",
		checkpointCount: 4,
		entryFile: "backup_scheduler",
		recommendedCheckpointBatch: [1, 3, 4],
		recommendedForceStageCount: 3,
		recommendedLongSessionThresholds: [5, 15, 40],
		antiSlopSignals: ["bounded CLI evolution", "verification carry-forward", "schema and event-history discipline"],
		rationale:
			"Good first anti-slop case for bounded CLI evolution. It pressures Balloon to preserve scheduling, exclusion, and event-history rules instead of widening into a broad rewrite.",
		openingPressure: "Starts as a scheduler-style CLI with explicit YAML, due-time, exclusion, and JSONL event constraints.",
		closingPressure: "Ends with pack and incremental-backup pressure, which is a good test of scope control and verification carry-forward.",
	},
	{
		problemName: "execution_server",
		category: "networking",
		difficulty: "Easy",
		checkpointCount: 6,
		entryFile: "execution_server",
		recommendedCheckpointBatch: [1, 4, 6],
		recommendedForceStageCount: 3,
		recommendedLongSessionThresholds: [5, 15, 40],
		antiSlopSignals: ["scope control", "stateful feature layering", "timeout and concurrency discipline"],
		rationale:
			"Good first networking case for keeping additive server requirements coherent without drifting into architecture churn or dropping follow-on operational constraints.",
		openingPressure: "Starts as an HTTP execution server with process and output handling pressure.",
		closingPressure: "Ends with caching, persistence, concurrency, scheduling, and dependency-graph pressure that exposes structural erosion quickly.",
	},
	{
		problemName: "trajectory_api",
		category: "web",
		difficulty: "Easy",
		checkpointCount: 5,
		entryFile: "trajectory_api",
		recommendedCheckpointBatch: [1, 3, 5],
		recommendedForceStageCount: 3,
		recommendedLongSessionThresholds: [5, 15, 40],
		antiSlopSignals: ["API invariant preservation", "concurrency discipline", "layered validation without sprawl"],
		rationale:
			"Good first API case for checking whether Balloon preserves validation and boundary rules as the spec grows into ETags, forking, grammar parsing, and sandboxed execution.",
		openingPressure: "Starts as a trajectory-storage API with validation and reporting expectations.",
		closingPressure: "Ends with mutable lineage, ETag concurrency, grammar parsing, and sandbox boundaries that punish sloppy scope growth.",
	},
]

function uniqueStrings(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>()
	const output: string[] = []
	for (const value of values) {
		if (!value) continue
		const normalized = path.resolve(value)
		if (seen.has(normalized)) continue
		seen.add(normalized)
		output.push(normalized)
	}
	return output
}

export function resolveSlopCodeBenchDatasetRoot(requestedRoot?: string | null, baseDir = process.cwd()): string | null {
	const explicit = requestedRoot && requestedRoot.trim().length > 0 ? path.resolve(baseDir, requestedRoot.trim()) : null
	const candidates = uniqueStrings([
		explicit,
		path.join(baseDir, "slop-code-bench-main"),
		path.join(baseDir, "..", "slop-code-bench-main"),
	])
	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate
	}
	return explicit
}

export function getSlopCodeDatasetStatus(requestedRoot?: string | null, baseDir = process.cwd()): SlopCodeDatasetStatus {
	const datasetRoot = resolveSlopCodeBenchDatasetRoot(requestedRoot, baseDir)
	const present = Boolean(datasetRoot && fs.existsSync(datasetRoot))
	const hasGitMetadata = Boolean(datasetRoot && fs.existsSync(path.join(datasetRoot, ".git")))
	const warnings: string[] = []
	let verificationStatus: SlopCodeDatasetStatus["verificationStatus"] = "missing"

	if (!present) {
		warnings.push("No local SlopCodeBench dataset root was found. Provide --dataset-root or place a snapshot near the Balloon repo.")
		return {
			datasetRoot: datasetRoot ?? null,
			present: false,
			hasGitMetadata: false,
			verificationStatus,
			warnings,
		}
	}

	const problemsDir = path.join(datasetRoot as string, "problems")
	const hasProblemsDir = fs.existsSync(problemsDir)
	const hasReadme = fs.existsSync(path.join(datasetRoot as string, "README.md"))
	verificationStatus = hasProblemsDir && hasReadme ? "verified" : "partial"

	if (!hasGitMetadata) {
		warnings.push("Local dataset snapshot has no .git directory, so the upstream revision is still not commit-pinned.")
	}
	if (!hasProblemsDir) {
		warnings.push("Dataset root exists but the problems directory is missing.")
	}
	if (!hasReadme) {
		warnings.push("Dataset root exists but README.md is missing.")
	}

	return {
		datasetRoot: datasetRoot as string,
		present: true,
		hasGitMetadata,
		verificationStatus,
		warnings,
	}
}

export function getSlopCodeStarterSuiteEntries(): SlopCodeStarterSuiteEntry[] {
	return STARTER_SUITE_SEEDS.map((seed) => ({
		problemName: seed.problemName,
		category: seed.category,
		difficulty: seed.difficulty,
		checkpointCount: seed.checkpointCount,
		entryFile: seed.entryFile,
		recommendedCheckpointBatch: [...seed.recommendedCheckpointBatch],
		recommendedForceStageCount: seed.recommendedForceStageCount,
		recommendedLongSessionThresholds: [...seed.recommendedLongSessionThresholds],
		antiSlopSignals: [...seed.antiSlopSignals],
		rationale: seed.rationale,
		openingPressure: seed.openingPressure,
		closingPressure: seed.closingPressure,
	}))
}

export function getBenchmarkScoreDimensions(): BalloonBenchmarkScoreDimension[] {
	return STARTER_SUITE_SCORE_DIMENSIONS.map((dimension) => ({ ...dimension }))
}

export function buildSlopCodeStarterSuite(requestedRoot?: string | null, baseDir = process.cwd()): SlopCodeStarterSuiteResult {
	const entries = getSlopCodeStarterSuiteEntries()
	return {
		suiteName: STARTER_SUITE_NAME,
		datasetStatus: getSlopCodeDatasetStatus(requestedRoot, baseDir),
		problemCount: entries.length,
		entries,
	}
}

function buildSuggestedScorePrompt(preparation: SlopCodeProblemPreparation): string {
	return [
		"Use #balloon_score_benchmark_lanes with:",
		"",
		`- sessionId: ${preparation.recommendedSessionId}`,
		"- userRequest: <paste the latest checkpoint request here>",
		"- semanticAdapterPath: .\\examples\\semantic_cara_adapter.example.mjs",
		`- forceStageCount: ${preparation.entry.recommendedForceStageCount}`,
		"",
		"Return text only.",
		"Do not edit files.",
		"Do not apply patches.",
		"Do not run terminal commands.",
	].join("\n")
}

function buildSuggestedLongSessionPrompt(preparation: SlopCodeProblemPreparation): string {
	return [
		"Use #balloon_run_long_session_benchmark with:",
		"",
		`- sessionId: ${preparation.recommendedSessionId}`,
		`- checkpoints: [${preparation.entry.recommendedCheckpointBatch.join(", ")}]`,
		"- semanticAdapterPath: .\\examples\\semantic_cara_adapter.example.mjs",
		`- forceStageCount: ${preparation.entry.recommendedForceStageCount}`,
		`- stageThresholds: [${preparation.entry.recommendedLongSessionThresholds.join(", ")}]`,
		"",
		"Return text only.",
		"Do not edit files.",
		"Do not apply patches.",
		"Do not run terminal commands.",
	].join("\n")
}

export function buildSlopCodeProblemPreparation(problemName: string, requestedRoot?: string | null, baseDir = process.cwd()): SlopCodeProblemPreparation | null {
	const entry = getSlopCodeStarterSuiteEntries().find((candidate) => candidate.problemName === problemName)
	if (!entry) return null
	const datasetStatus = getSlopCodeDatasetStatus(requestedRoot, baseDir)
	const problemDir = datasetStatus.present && datasetStatus.datasetRoot ? path.join(datasetStatus.datasetRoot, "problems", entry.problemName) : null
	const configPath = problemDir ? path.join(problemDir, "config.yaml") : null
	const staticAssetsPath = problemDir ? path.join(problemDir, "files") : null
	const testsDirPath = problemDir ? path.join(problemDir, "tests") : null
	const checkpointFiles = Array.from({ length: entry.checkpointCount }, (_, index) => {
		const checkpoint = index + 1
		const filePath = problemDir ? path.join(problemDir, `checkpoint_${checkpoint}.md`) : null
		return {
			checkpoint,
			path: filePath,
			exists: Boolean(filePath && fs.existsSync(filePath)),
		}
	})
	const missingFiles = [
		...(configPath && !fs.existsSync(configPath) ? [configPath] : []),
		...(testsDirPath && !fs.existsSync(testsDirPath) ? [testsDirPath] : []),
		...checkpointFiles.filter((file) => !file.exists && file.path).map((file) => file.path as string),
	]
	const recommendedSessionId = `scbench-${entry.problemName.replace(/_/gu, "-")}`
	const recommendedInstructions = [
		`Use checkpoint_1 through checkpoint_${entry.checkpointCount} in order; do not skip the opening checkpoint when building the session.`,
		`Score at least checkpoints ${entry.recommendedCheckpointBatch.join(", ")} so you see both the opening shape and the later erosion pressure.`,
		`For short checkpoint comparisons, force all ${entry.recommendedForceStageCount} staged Balloon families active so the external prototype stays visible.`,
		`If you stretch the problem into a longer chat, start staged thresholds at ${entry.recommendedLongSessionThresholds.join(" / ")} and only tighten them after real reruns.`,
		"Capture whether Balloon preserves bounded next steps, protected areas, and verification obligations better than the baseline lane.",
	]
	const suggestedCompareBenchmarkPrompt = [
		"Use #balloon_compare_benchmark_lanes with:",
		"",
		`- sessionId: ${recommendedSessionId}`,
		"- userRequest: <paste the latest checkpoint request here>",
		"- semanticAdapterPath: .\\examples\\semantic_cara_adapter.example.mjs",
		`- forceStageCount: ${entry.recommendedForceStageCount}`,
		"",
		"Return text only.",
		"Do not edit files.",
		"Do not apply patches.",
		"Do not run terminal commands.",
	].join("\n")

	return {
		problemName: entry.problemName,
		datasetStatus,
		entry,
		problemDir,
		configPath,
		staticAssetsPath,
		testsDirPath,
		checkpointFiles,
		missingFiles,
		recommendedSessionId,
		recommendedInstructions,
		suggestedCompareBenchmarkPrompt,
	}
}

function buildProblemPlan(entry: SlopCodeStarterSuiteEntry, requestedRoot?: string | null, baseDir = process.cwd()): SlopCodeStarterBenchmarkProblemPlan {
	const preparation = buildSlopCodeProblemPreparation(entry.problemName, requestedRoot, baseDir)
	const recommendedSessionId = preparation?.recommendedSessionId ?? `scbench-${entry.problemName.replace(/_/gu, "-")}`
	return {
		problemName: entry.problemName,
		category: entry.category,
		difficulty: entry.difficulty,
		recommendedSessionId,
		recommendedCheckpointBatch: [...entry.recommendedCheckpointBatch],
		recommendedForceStageCount: entry.recommendedForceStageCount,
		recommendedLongSessionThresholds: [...entry.recommendedLongSessionThresholds],
		scoreFocus: [...entry.antiSlopSignals],
		successSignals: [
			"preserves protected areas and explicit architecture direction",
			"keeps verification obligations alive in the repaired reply",
			"stays bounded when later checkpoint pressure stacks up",
		],
		suggestedCompareBenchmarkPrompt:
			preparation?.suggestedCompareBenchmarkPrompt ??
			[
				"Use #balloon_compare_benchmark_lanes with:",
				"",
				`- sessionId: ${recommendedSessionId}`,
				"- userRequest: <paste the latest checkpoint request here>",
				"- semanticAdapterPath: .\\examples\\semantic_cara_adapter.example.mjs",
				`- forceStageCount: ${entry.recommendedForceStageCount}`,
			].join("\n"),
		suggestedScorePrompt:
			preparation ? buildSuggestedScorePrompt(preparation) : `Use #balloon_score_benchmark_lanes with sessionId ${recommendedSessionId}.`,
		suggestedLongSessionPrompt:
			preparation
				? buildSuggestedLongSessionPrompt(preparation)
				: `Use #balloon_run_long_session_benchmark with sessionId ${recommendedSessionId} and stageThresholds [${entry.recommendedLongSessionThresholds.join(", ")}].`,
	}
}

export function buildSlopCodeStarterBenchmarkPlan(requestedRoot?: string | null, baseDir = process.cwd()): SlopCodeStarterBenchmarkPlan {
	const suite = buildSlopCodeStarterSuite(requestedRoot, baseDir)
	return {
		suiteName: `${suite.suiteName} Runbook`,
		datasetStatus: suite.datasetStatus,
		executionOrder: suite.entries.map((entry) => entry.problemName),
		scoreDimensions: getBenchmarkScoreDimensions(),
		runChecklist: [
			"Verify the local dataset snapshot before claiming benchmark-backed evidence.",
			"Run each selected problem in order and keep forceStageCount at 3 for the first checkpoint-sequence pass.",
			"Capture compare-lanes output and score it with the same six-dimension scorecard each time.",
			"Only move to 25 or 50 turn extensions after the checkpoint-sequence reruns look healthy.",
			"Do not claim SlopCodeBench victory from this starter suite alone.",
		],
		communicationBoundaries: [
			"Say Balloon has a dataset-backed starter-suite path, not a full benchmark win.",
			"Use these runs to tune anti-slop behavior, not to overclaim long-horizon mastery.",
			"Keep latency and correction-tax notes alongside any score summary.",
		],
		problems: suite.entries.map((entry) => buildProblemPlan(entry, requestedRoot, baseDir)),
	}
}
