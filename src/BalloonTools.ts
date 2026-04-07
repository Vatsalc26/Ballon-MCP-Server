import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import type {
	BalloonDriftPressure,
	BalloonDriftPressureHistorySummary,
	BalloonDriftPressureSnapshot,
	BalloonGap,
	BalloonHostConfigRoot,
	BalloonHostFlowKind,
	BalloonHostFlowPacket,
	BalloonHostKind,
	BalloonHostPromptPacket,
	BalloonHostReadinessTier,
	BalloonHostValidationCaseEvidenceRollup,
	BalloonHostValidationCase,
	BalloonHostValidationCaseId,
	BalloonHostValidationEvidence,
	BalloonHostValidationEvidenceSummary,
	BalloonHostValidationResultStatus,
	BalloonHostValidationSuite,
	BalloonInstallDiagnostics,
	BalloonHostSetupPacket,
	BalloonHostSetupValidation,
	BalloonHostSurface,
	BalloonBenchmarkDimensionScore,
	BalloonBenchmarkLaneTotals,
	BalloonBenchmarkLaneScore,
	BalloonBenchmarkScorecard,
	BalloonBenchmarkScoreDimension,
	BalloonPersistentDriftBias,
	BalloonSessionSummary,
	BalloonSlopCodeEvidenceSummary,
	BalloonSlopCodeEvidenceCoverage,
	BalloonSlopCodeEvidenceKind,
	BalloonSlopCodeLiveRunBatchPacket,
	BalloonSlopCodeLiveRunPacket,
	BalloonSlopCodeProblemEvidenceSummary,
	BalloonSlopCodeRunEvidence,
	BalloonSlopCodeTranscriptSource,
	BenchmarkLaneComparison,
	HiddenRequirement,
	LongSessionCheckpointMode,
	LongSessionBenchmarkCheckpoint,
	LongSessionBenchmarkCheckpointScore,
	LongSessionBenchmarkResult,
	LongSessionBenchmarkScoreResult,
	ProxyTrickle,
	ReleasePacket,
	RetrievalHit,
	SemanticCaraResult,
	SlopCodeDatasetVerificationStatus,
	SlopCodeStarterBenchmarkPlan,
	SlopCodeStarterSuiteSummary,
	SlopCodeProblemPreparation,
	SlopCodeStarterSuiteResult,
	StagedBalloonResult,
	StructuredProfile,
} from "./types"
import { BalloonStateStore } from "./BalloonStateStore"
import {
	auditLatestTurn,
	buildDriftPressure,
	buildPersistentDriftBias,
	buildProxyTrickle,
	buildStructuredProfile,
	createDriftPressureSnapshot,
	detectHiddenRequirements,
	retrieveRelevantTurns,
	summarizeDriftPressureHistory,
	summarizeMemoryPromotion,
} from "./BalloonAnalysis"
import { buildBalloonRepairBundle } from "./BalloonRepair"
import { buildReviewPromptBundle, getBalloonPrompt, listBalloonPrompts } from "./BalloonPrompts"
import { buildStagedBalloonResult } from "./BalloonStaged"
import {
	buildSlopCodeProblemPreparation,
	buildSlopCodeStarterBenchmarkPlan,
	buildSlopCodeStarterSuite,
	getBenchmarkScoreDimensions,
	getSlopCodeDatasetStatus,
	getSlopCodeStarterSuiteEntries,
} from "./SlopCodeBench"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
type JsonRecord = Record<string, unknown>

export type ToolResult = {
	content: Array<{ type: "text"; text: string }>
	structuredContent?: JsonRecord
	isError?: boolean
}

export type ResourceDefinition = {
	uri: string
	name: string
	title: string
	description: string
	mimeType: string
}

export type ResourceContent = {
	uri: string
	mimeType: string
	text: string
}

type ToolContext = {
	store: BalloonStateStore
}

type ToolDefinition = {
	name: string
	title: string
	description: string
	annotations?: Record<string, boolean | string | number>
	inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] }
	run: (args: Record<string, unknown>, context: ToolContext) => ToolResult
}

function textResult(text: string, structuredContent?: JsonRecord): ToolResult {
	return {
		content: [{ type: "text", text }],
		structuredContent,
	}
}

function toolError(text: string, structuredContent?: JsonRecord): ToolResult {
	return {
		content: [{ type: "text", text }],
		structuredContent,
		isError: true,
	}
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asRecordValue(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asPositiveInt(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value)
	if (typeof value === "string" && /^\d+$/u.test(value)) return Math.max(1, Number.parseInt(value, 10))
	return fallback
}

function asPositiveIntArray(value: unknown, fallback: number[]): number[] {
	if (!Array.isArray(value)) return [...fallback]
	const normalized = value
		.map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? Math.floor(entry) : typeof entry === "string" && /^\d+$/u.test(entry) ? Number.parseInt(entry, 10) : NaN))
		.filter((entry) => Number.isFinite(entry) && entry > 0)
	return normalized.length > 0 ? normalized : [...fallback]
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value.map((entry) => asString(entry)).filter((entry): entry is string => entry !== null)
}

function parseCheckpointMode(value: unknown, fallback: LongSessionCheckpointMode = "turn_count"): LongSessionCheckpointMode {
	if (typeof value !== "string") return fallback
	switch (value.trim().toLowerCase()) {
		case "assistant_checkpoint":
			return "assistant_checkpoint"
		case "turn_count":
		default:
			return fallback
	}
}

function toPortablePath(value: string): string {
	return value.replace(/\\/g, "/")
}

function parseHostKind(value: unknown, fallback: BalloonHostKind = "vscode"): BalloonHostKind {
	if (typeof value !== "string") return fallback
	switch (value.trim().toLowerCase()) {
		case "cline":
			return "cline"
		case "roo":
		case "roo_code":
			return "roo_code"
		case "claude":
		case "claude_desktop":
			return "claude_desktop"
		case "generic":
		case "generic_json":
			return "generic_json"
		case "vscode":
		default:
			return fallback
	}
}

function asTurns(value: unknown): Array<{ role: string; content: string; timestamp?: string }> {
	if (!Array.isArray(value)) return []
	const normalized: Array<{ role: string; content: string; timestamp?: string }> = []
	for (const entry of value) {
		if (!entry || typeof entry !== "object") continue
		const candidate = entry as Record<string, unknown>
		const role = asString(candidate.role)
		const content = asString(candidate.content)
		const timestamp = asString(candidate.timestamp) ?? undefined
		if (!role || !content) continue
		normalized.push({ role, content, timestamp })
	}
	return normalized
}

function formatProfile(profile: StructuredProfile): string {
	return [
		`Session: ${profile.sessionId}`,
		`Goals: ${profile.goals.length}`,
		`Constraints: ${profile.constraints.length}`,
		`Protected areas: ${profile.protectedAreas.length}`,
		`Verification obligations: ${profile.verificationObligations.length}`,
		`Architecture direction: ${profile.architectureDirection.length}`,
		`Updated: ${profile.updatedAt}`,
	].join("\n")
}

function formatGaps(gaps: BalloonGap[]): string {
	if (gaps.length === 0) return "No gaps detected."
	return gaps.map((gap, index) => `${index + 1}. [${gap.severity}] ${gap.title} - ${gap.description}`).join("\n")
}

function formatDriftPressure(pressure: BalloonDriftPressure): string {
	return [
		`Score: ${pressure.score}/100`,
		`Level: ${pressure.level}`,
		`Dominant gap types: ${pressure.dominantGapTypes.join(", ") || "none"}`,
		`Request coverage: ${pressure.requestCoverage}`,
		`Profile anchor coverage: ${pressure.profileAnchorCoverage}`,
		...(pressure.reasons.length > 0 ? ["Reasons", ...pressure.reasons.map((reason, index) => `${index + 1}. ${reason}`)] : ["Reasons", "No major drift pressure recorded."]),
	].join("\n")
}

function formatDriftPressureHistory(summary: BalloonDriftPressureHistorySummary): string {
	return [
		`Total snapshots: ${summary.totalSnapshots}`,
		`Latest score: ${summary.latestScore ?? "none"}`,
		`Latest level: ${summary.latestLevel ?? "none"}`,
		`Peak score: ${summary.peakScore ?? "none"}`,
		`Average score: ${summary.averageScore ?? "none"}`,
		`Trend: ${summary.trend}`,
		...(summary.reasons.length > 0 ? ["Reasons", ...summary.reasons.map((reason, index) => `${index + 1}. ${reason}`)] : []),
	].join("\n")
}

function buildDriftPressureHistorySummary(store: BalloonStateStore, sessionId: string, limit = 50): BalloonDriftPressureHistorySummary {
	return summarizeDriftPressureHistory(sessionId, store.listDriftPressureSnapshots(sessionId, limit))
}

function persistDriftPressureSnapshot(
	store: BalloonStateStore,
	input: {
		sessionId: string
		source: BalloonDriftPressureSnapshot["source"]
		turnCount: number
		requestText?: string | null
		latestResponse?: string | null
		pressure: BalloonDriftPressure
	},
): BalloonDriftPressureSnapshot {
	const snapshot = createDriftPressureSnapshot(input)
	store.saveDriftPressureSnapshot(snapshot)
	return snapshot
}

function formatHiddenRequirements(requirements: HiddenRequirement[]): string {
	if (requirements.length === 0) return "No hidden requirements detected."
	return requirements.map((requirement, index) => `${index + 1}. ${requirement.requirement} - ${requirement.rationale}${requirement.coveredByResponse ? " [already covered]" : ""}`).join("\n")
}

function formatList(values: string[], fallback: string): string {
	if (values.length === 0) return fallback
	return values.map((value, index) => `${index + 1}. ${value}`).join("\n")
}

function formatRetrievalHits(hits: RetrievalHit[]): string {
	if (hits.length === 0) return "No targeted retrieval hits found."
	return hits
		.map((hit, index) => `${index + 1}. (${hit.role}, score=${hit.score}) ${hit.content}${hit.biasReasons.length > 0 ? ` [bias: ${hit.biasReasons.join(", ")}]` : ""}`)
		.join("\n")
}

function formatTrickle(trickle: ProxyTrickle): string {
	const persistentFocus = trickle.persistentFocus ?? []
	return [trickle.summary, ...(persistentFocus.length > 0 ? ["", `Persistent focus: ${persistentFocus.join(", ")}`] : []), "", trickle.deliveryText].join("\n")
}

function formatReleasePacket(packet: ReleasePacket): string {
	const persistentFocus = packet.persistentFocus ?? []
	const focusLine = persistentFocus.length > 0 ? [`Persistent focus: ${persistentFocus.join(", ")}`] : []
	const releasedLines =
		packet.released.length > 0
			? packet.released
					.slice(0, 6)
					.map(
						(item, index) =>
							`${index + 1}. ${item.sourceText} [${item.sourceKind}, score=${item.similarityScore.toFixed(2)}, threshold=${item.threshold.toFixed(2)}${item.biasReasons.length > 0 ? `, bias=${item.biasReasons.join(",")}` : ""}]`,
					)
			: ["No released corrections."]
	const heldLines =
		packet.held.length > 0
			? packet.held
					.slice(0, 4)
					.map(
						(item, index) =>
							`${index + 1}. ${item.sourceText} [${item.sourceKind}, score=${item.similarityScore.toFixed(2)}, threshold=${item.threshold.toFixed(2)}${item.biasReasons.length > 0 ? `, bias=${item.biasReasons.join(",")}` : ""}]`,
					)
			: ["No held corrections."]
	return [
		packet.summary,
		...focusLine,
		"",
		packet.deliveryText,
		"",
		"Released corrections",
		...releasedLines,
		"",
		"Held corrections",
		...heldLines,
	].join("\n")
}

function formatStagedResult(result: StagedBalloonResult): string {
	const stageLines = result.stages.map((stage) =>
		[
			`${stage.label}: ${stage.active ? "active" : "inactive"}`,
			`Reason: ${stage.reason}`,
			`Summary: ${stage.stageSummary}`,
			stage.trickleInstructions.length > 0 ? `Instructions: ${stage.trickleInstructions.join(" | ")}` : "Instructions: none",
		].join("\n"),
	)
	return [
		`Turn count: ${result.turnCount}`,
		`Thresholds: ${result.thresholds.join(", ")}`,
		`Forced stage count: ${result.forcedStageCount ?? "none"}`,
		`Active stages: ${result.activeStageCount}`,
		"",
		"Drift pressure",
		formatDriftPressure(result.driftPressure),
		"",
		...stageLines,
		"",
		"Deterministic reply",
		result.deterministicReply,
		"",
		"Staged external reply",
		result.stagedReply,
		"",
		"Release packet",
		formatReleasePacket(result.releasePacket),
	].join("\n")
}

function formatSemanticCara(result: SemanticCaraResult): string {
	if (result.status === "disabled") return "Semantic CARA disabled."
	const lines = [
		`Status: ${result.status}`,
		`Mode: ${result.mode}`,
		`Source: ${result.providerMeta.source}`,
		`Duration: ${result.providerMeta.durationMs} ms`,
		...(result.providerMeta.requestedAdapterPath ? [`Requested adapter: ${result.providerMeta.requestedAdapterPath}`] : []),
		...(result.providerMeta.adapterPath ? [`Resolved adapter: ${result.providerMeta.adapterPath}`] : []),
		...(result.notes.length > 0 ? ["Notes:", ...result.notes.map((note, index) => `${index + 1}. ${note}`)] : ["Notes: none"]),
		...(result.suggestedAdditions.length > 0 ? ["Suggested additions:", ...result.suggestedAdditions.map((item, index) => `${index + 1}. ${item}`)] : []),
		...(result.error ? [`Error: ${result.error}`] : []),
	]
	return lines.join("\n")
}

function formatPromptMessages(messages: Array<{ role: string; content?: { text?: string } }>): string {
	if (messages.length === 0) return "No prompt messages generated."
	return messages
		.map((message, index) => {
			const text = message.content?.text?.trim() ?? ""
			return `${index + 1}. [${message.role}]\n${text || "(empty)"}`
		})
		.join("\n\n")
}

function formatPersistentBias(bias: BalloonPersistentDriftBias): string {
	return [
		`Focus order: ${bias.focusOrder.join(", ") || "none"}`,
		`Repeated gap types: ${bias.repeatedGapTypes.join(", ") || "none"}`,
		`Sustained pressure: ${bias.sustainedPressure ? "yes" : "no"}`,
		...(bias.reasons.length > 0 ? ["Reasons", ...bias.reasons.map((reason, index) => `${index + 1}. ${reason}`)] : []),
	].join("\n")
}

function buildNextTurnStance(
	profile: StructuredProfile,
	hiddenRequirements: HiddenRequirement[],
	driftPressure: BalloonDriftPressure,
	trickle: ProxyTrickle,
	persistentBias: BalloonPersistentDriftBias,
): string[] {
	const missingRequirements = hiddenRequirements.filter((requirement) => !requirement.coveredByResponse).map((requirement) => requirement.requirement)
	const architectureDirection = profile.architectureDirection.find((entry) => !profile.protectedAreas.includes(entry))
	const protectedInterface = profile.protectedInterfaces[0]
	const styleRequirement = profile.styleRequirements[0]
	return [
		...(persistentBias.focusOrder.includes("architecture") ? ["Persistent focus: recover architecture direction first."] : []),
		...(persistentBias.focusOrder.includes("verification") ? ["Persistent focus: keep verification obligations visible in the next turn."] : []),
		...(driftPressure.level === "critical"
			? ["Priority: correct the drift before widening scope."]
			: driftPressure.level === "high"
				? ["Priority: re-anchor the next turn before adding polish."]
				: []),
		...(profile.protectedAreas[0] ? [`Avoid changing: ${profile.protectedAreas[0]}`] : []),
		...(driftPressure.needsInterfaceRecovery && protectedInterface ? [`Preserve interface: ${protectedInterface}`] : []),
		...(architectureDirection ? [`Preserve direction: ${architectureDirection}`] : []),
		...(profile.verificationObligations[0] ? [`Verify: ${profile.verificationObligations[0]}`] : []),
		...(driftPressure.needsStyleRecovery && styleRequirement ? [`Keep style/type pressure: ${styleRequirement}`] : []),
		...(missingRequirements.length > 0 ? [`Include: ${missingRequirements.slice(0, 3).join(", ")}`] : []),
		...(trickle.priorityInstructions[0] ? [`Pressure: ${trickle.priorityInstructions[0]}`] : []),
	].slice(0, 5)
}

function formatSessionSummary(summary: BalloonSessionSummary): string {
	return [
		`Session: ${summary.sessionId}`,
		`Turns: ${summary.turnCount}`,
		`Gaps: ${summary.gapCount}`,
		`Trickles: ${summary.trickleCount}`,
		`Memory items: ${summary.memoryCount}`,
		`Release packets: ${summary.releaseCount}`,
		`Last updated: ${summary.lastUpdatedAt ?? "unknown"}`,
	].join("\n")
}

function findLatestTurnContent(turns: Array<{ role: string; content: string; timestamp?: string }>, role: "user" | "assistant"): string | undefined {
	for (let index = turns.length - 1; index >= 0; index -= 1) {
		const turn = turns[index]
		if (turn?.role === role) return turn.content
	}
	return undefined
}

function getActiveGaps(store: BalloonStateStore, sessionId: string, requestedGapIds: string[]): BalloonGap[] {
	if (requestedGapIds.length > 0) return store.getGapsByIds(sessionId, requestedGapIds)
	return store.getRecentGaps(sessionId, 8)
}

type BenchmarkLaneOptions = {
	userRequest?: string
	latestResponse?: string
	semanticAdapterPath?: unknown
	semanticTimeoutMs?: unknown
	semanticMaxNotes?: unknown
	forceStageCount?: unknown
	stageThresholds?: unknown
}

function buildBenchmarkLaneComparison(store: BalloonStateStore, sessionId: string, options: BenchmarkLaneOptions): BenchmarkLaneComparison | null {
	const baseline = buildBalloonRepairBundle(store, sessionId, {
		userRequest: options.userRequest,
		latestResponse: options.latestResponse,
		semanticMode: "off",
	})
	if (!baseline) return null
	const assist = buildBalloonRepairBundle(store, sessionId, {
		userRequest: options.userRequest,
		latestResponse: options.latestResponse,
		semanticMode: "assist",
		semanticAdapterPath: options.semanticAdapterPath,
		semanticTimeoutMs: options.semanticTimeoutMs,
		semanticMaxNotes: options.semanticMaxNotes,
	})
	if (!assist) return null
	const staged = buildStagedBalloonResult(store, sessionId, {
		userRequest: options.userRequest,
		latestResponse: options.latestResponse,
		forceStageCount: options.forceStageCount,
		stageThresholds: options.stageThresholds,
	})
	if (!staged) return null
	const baselineReply = baseline.latestResponse ?? "(no latest assistant response found)"
	return {
		sessionId,
		requestText: baseline.requestText,
		latestResponse: baseline.latestResponse,
		baselineReply,
		deterministicReply: baseline.repairedReply,
		deterministicDriftPressure: baseline.driftPressure,
		assistReply: assist.repairedReply,
		stagedReply: staged.stagedReply,
		deterministicCorrectionSummary: baseline.correctionSummary,
		assistCorrectionSummary: assist.correctionSummary,
		stagedCorrectionSummary: staged.stagedCorrectionSummary,
		baselineDiffers: baselineReply.trim() !== baseline.repairedReply.trim(),
		assistDiffers: assist.repairedReply.trim() !== baseline.repairedReply.trim(),
		stagedDiffers: staged.stagedReply.trim() !== baseline.repairedReply.trim(),
		assistSemanticCara: assist.semanticCara,
		assistReleasePacket: assist.releasePacket,
		stagedReleasePacket: staged.releasePacket,
		stagedActiveStageCount: staged.activeStageCount,
		stagedThresholds: staged.thresholds,
		stagedStages: staged.stages,
	}
}

function resolveCheckpointTurns(
	turns: Array<{ role: string; content: string; timestamp?: string }>,
	requestedCheckpoints: number[],
	checkpointMode: LongSessionCheckpointMode,
): Array<{ checkpoint: number; actualTurnCount: number }> {
	const resolved: Array<{ checkpoint: number; actualTurnCount: number }> = []
	const seen = new Set<number>()
	const assistantTurnCounts = turns
		.map((turn, index) => ({ role: turn.role, turnCount: index + 1 }))
		.filter((entry) => entry.role === "assistant")
		.map((entry) => entry.turnCount)
	for (const checkpoint of [...requestedCheckpoints].sort((left, right) => left - right)) {
		let actualTurnCount: number | null = null
		if (checkpointMode === "assistant_checkpoint") {
			actualTurnCount = assistantTurnCounts[checkpoint - 1] ?? null
		} else {
			const capped = Math.min(checkpoint, turns.length)
			let index = capped - 1
			while (index >= 0 && turns[index]?.role !== "assistant") index -= 1
			if (index >= 0) actualTurnCount = index + 1
		}
		if (actualTurnCount === null) continue
		if (seen.has(actualTurnCount)) continue
		const checkpointTurns = turns.slice(0, actualTurnCount)
		if (!findLatestTurnContent(checkpointTurns, "user") || !findLatestTurnContent(checkpointTurns, "assistant")) continue
		seen.add(actualTurnCount)
		resolved.push({ checkpoint, actualTurnCount })
	}
	return resolved
}

function formatLongSessionCheckpoint(checkpoint: LongSessionBenchmarkCheckpoint): string {
	return [
		`Requested checkpoint: ${checkpoint.checkpoint}`,
		`Executed turn count: ${checkpoint.actualTurnCount}`,
		`Checkpoint session: ${checkpoint.checkpointSessionId}`,
		`Drift pressure: ${checkpoint.driftPressure.level} (${checkpoint.driftPressure.score}/100)`,
		`Assist semantic status: ${checkpoint.comparison.assistSemanticCara.status}`,
		`Staged active stages: ${checkpoint.comparison.stagedActiveStageCount}`,
		`Assist differs from deterministic: ${checkpoint.comparison.assistDiffers ? "yes" : "no"}`,
		`Staged differs from deterministic: ${checkpoint.comparison.stagedDiffers ? "yes" : "no"}`,
		"",
		"Baseline reply",
		checkpoint.comparison.baselineReply,
		"",
		"Deterministic Balloon reply",
		checkpoint.comparison.deterministicReply,
		"",
		"Assist Balloon reply",
		checkpoint.comparison.assistReply,
		"",
		"Staged external Balloon reply",
		checkpoint.comparison.stagedReply,
	].join("\n")
}

function formatSlopCodeDatasetStatus(result: SlopCodeStarterSuiteResult["datasetStatus"]): string {
	return [
		`Dataset present: ${result.present ? "yes" : "no"}`,
		`Verification status: ${result.verificationStatus}`,
		`Git metadata present: ${result.hasGitMetadata ? "yes" : "no"}`,
		`Dataset root: ${result.datasetRoot ?? "not found"}`,
		...(result.warnings.length > 0 ? ["Warnings", ...result.warnings.map((warning, index) => `${index + 1}. ${warning}`)] : ["Warnings", "None"]),
	].join("\n")
}

function formatSlopCodeStarterSuite(result: SlopCodeStarterSuiteResult): string {
	const entryLines = result.entries.flatMap((entry, index) => [
		`${index + 1}. ${entry.problemName} [${entry.category}, ${entry.difficulty}, checkpoints=${entry.checkpointCount}]`,
		`Why it fits: ${entry.rationale}`,
		`Checkpoint batch: ${entry.recommendedCheckpointBatch.join(", ")}`,
		`Force staged count: ${entry.recommendedForceStageCount}`,
		`Long-session thresholds: ${entry.recommendedLongSessionThresholds.join(" / ")}`,
		`Anti-slop signals: ${entry.antiSlopSignals.join(" | ")}`,
	])
	return [
		`${result.suiteName}`,
		"",
		formatSlopCodeDatasetStatus(result.datasetStatus),
		"",
		`Problem count: ${result.problemCount}`,
		...entryLines,
	].join("\n")
}

function formatSlopCodeProblemPreparation(result: SlopCodeProblemPreparation): string {
	return [
		`Problem: ${result.problemName}`,
		`Category: ${result.entry.category}`,
		`Difficulty: ${result.entry.difficulty}`,
		`Checkpoint count: ${result.entry.checkpointCount}`,
		`Recommended session id: ${result.recommendedSessionId}`,
		`Recommended checkpoint batch: ${result.entry.recommendedCheckpointBatch.join(", ")}`,
		`Recommended checkpoint mode: ${result.recommendedCheckpointMode}`,
		`Force staged count: ${result.entry.recommendedForceStageCount}`,
		`Long-session thresholds: ${result.entry.recommendedLongSessionThresholds.join(" / ")}`,
		"",
		"Dataset status",
		formatSlopCodeDatasetStatus(result.datasetStatus),
		"",
		"Why Balloon should test here",
		result.entry.rationale,
		`Opening pressure: ${result.entry.openingPressure}`,
		`Closing pressure: ${result.entry.closingPressure}`,
		"",
		"Checkpoint files",
		...result.checkpointFiles.map((file) => `${file.checkpoint}. ${file.path ?? "(dataset missing)"} [${file.exists ? "found" : "missing"}]`),
		"",
		"Suggested procedure",
		...result.recommendedInstructions.map((instruction, index) => `${index + 1}. ${instruction}`),
		"",
		"Suggested compare prompt",
		result.suggestedCompareBenchmarkPrompt,
		...(result.missingFiles.length > 0 ? ["", "Missing files", ...result.missingFiles.map((file, index) => `${index + 1}. ${file}`)] : []),
	].join("\n")
}

function formatSlopCodeStarterBenchmarkPlan(plan: SlopCodeStarterBenchmarkPlan): string {
	const problemLines = plan.problems.flatMap((problem, index) => [
		`${index + 1}. ${problem.problemName} [${problem.category}, ${problem.difficulty}]`,
		`Session id: ${problem.recommendedSessionId}`,
		`Checkpoint batch: ${problem.recommendedCheckpointBatch.join(", ")}`,
		`Checkpoint mode: ${problem.recommendedCheckpointMode}`,
		`Force stage count: ${problem.recommendedForceStageCount}`,
		`Long-session thresholds: ${problem.recommendedLongSessionThresholds.join(" / ")}`,
		`Score focus: ${problem.scoreFocus.join(" | ")}`,
		`Success signals: ${problem.successSignals.join(" | ")}`,
	])
	return [
		plan.suiteName,
		"",
		formatSlopCodeDatasetStatus(plan.datasetStatus),
		"",
		"Execution order",
		...plan.executionOrder.map((problemName, index) => `${index + 1}. ${problemName}`),
		"",
		"Score dimensions",
		...plan.scoreDimensions.map((dimension, index) => `${index + 1}. ${dimension.label} - ${dimension.description}`),
		"",
		"Run checklist",
		...plan.runChecklist.map((item, index) => `${index + 1}. ${item}`),
		"",
		"Communication boundaries",
		...plan.communicationBoundaries.map((item, index) => `${index + 1}. ${item}`),
		"",
		"Problem plans",
		...problemLines,
	].join("\n")
}

const BENCHMARK_STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"be",
	"by",
	"for",
	"from",
	"i",
	"in",
	"into",
	"is",
	"it",
	"its",
	"of",
	"on",
	"or",
	"that",
	"the",
		"this",
	"to",
	"we",
	"with",
	"would",
	"will",
	"while",
	"keep",
	"change",
	"changes",
	"step",
	"steps",
	"next",
	"affected",
	"requested",
	"latest",
	"reply",
	"explicit",
	"explicitly",
	"matter",
	"required",
])

function normalizeBenchmarkText(value: string): string {
	return value.toLowerCase()
}

function extractBenchmarkTerms(value: string): string[] {
	return normalizeBenchmarkText(value)
		.split(/[^a-z0-9_./-]+/u)
		.map((term) => term.trim())
		.filter((term) => term.length >= 2 && !BENCHMARK_STOP_WORDS.has(term))
}

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))]
}

function countMatchedTerms(replyText: string, sourceText: string): { matched: string[]; required: number } {
	const replyTerms = new Set(extractBenchmarkTerms(replyText))
	const sourceTerms = extractBenchmarkTerms(sourceText)
	if (sourceTerms.length === 0) return { matched: [], required: 0 }
	const matched = sourceTerms.filter((term) => replyTerms.has(term))
	const required = Math.min(3, Math.max(1, Math.ceil(sourceTerms.length / 2)))
	return { matched, required }
}

function replyMatchesConcept(replyText: string, sourceText: string): boolean {
	const normalizedReply = normalizeBenchmarkText(replyText)
	const normalizedSource = normalizeBenchmarkText(sourceText)
	if (normalizedSource.length > 0 && normalizedReply.includes(normalizedSource)) return true
	const { matched, required } = countMatchedTerms(replyText, sourceText)
	return required > 0 && matched.length >= required
}

function collectMatchedConcepts(replyText: string, sourceTexts: string[]): string[] {
	return sourceTexts.filter((sourceText) => replyMatchesConcept(replyText, sourceText))
}

function hasUnsafeRewrite(replyText: string): boolean {
	const text = normalizeBenchmarkText(replyText)
	return (
		/\b(?:i|we)\s+(?:will|would)\s+(?:rewrite|replace)\b/u.test(text) ||
		/\bfrom scratch\b/u.test(text) ||
		/\bskip tests\b/u.test(text) ||
		/\btests after the refactor\b/u.test(text) ||
		/\bworry about .* later\b/u.test(text)
	)
}

function hasScopeGuard(replyText: string): boolean {
	const text = normalizeBenchmarkText(replyText)
	return (
		text.includes("keep this change bounded") ||
		text.includes("smallest safe next step") ||
		text.includes("only this bounded change") ||
		text.includes("avoid changing") ||
		text.includes("leave") && text.includes("alone") ||
		text.includes("only widen scope after") ||
		text.includes("preserve the") ||
		text.includes("instead of starting with")
	)
}

function buildLaneScore(lane: BalloonBenchmarkLaneScore["lane"], dimensions: BalloonBenchmarkScoreDimension[], scores: Array<{ score: number; rationale: string }>): BalloonBenchmarkLaneScore {
	const dimensionScores: BalloonBenchmarkDimensionScore[] = dimensions.map((dimension, index) => ({
		key: dimension.key,
		label: dimension.label,
		score: scores[index]?.score ?? 0,
		rationale: scores[index]?.rationale ?? "No rationale recorded.",
	}))
	const total = dimensionScores.reduce((sum, score) => sum + score.score, 0)
	const maxTotal = dimensions.length * 2
	const topDimensions = dimensionScores.filter((score) => score.score === 2).map((score) => score.label.toLowerCase())
	return {
		lane,
		total,
		maxTotal,
		dimensionScores,
		summary:
			topDimensions.length > 0
				? `${lane} is strongest on ${topDimensions.slice(0, 3).join(", ")}.`
				: `${lane} still leaves material recovery work on the table.`,
	}
}

function scoreLaneReply(
	lane: BalloonBenchmarkLaneScore["lane"],
	replyText: string,
	profile: StructuredProfile,
	gaps: BalloonGap[],
	hiddenRequirements: HiddenRequirement[],
): BalloonBenchmarkLaneScore {
	const dimensions = getBenchmarkScoreDimensions()
	const unsafeRewrite = hasUnsafeRewrite(replyText)
	const scopeGuard = hasScopeGuard(replyText)
	const protectedConcepts = uniqueStrings([...profile.protectedAreas, ...profile.constraints])
	const architectureConcepts = uniqueStrings([...profile.architectureDirection, ...profile.protectedAreas])
	const verificationConcepts = uniqueStrings([
		...profile.verificationObligations,
		...hiddenRequirements.filter((requirement) => !requirement.coveredByResponse).map((requirement) => requirement.requirement),
	])

	const matchedProtectedConcepts = collectMatchedConcepts(replyText, protectedConcepts)
	const matchedArchitectureConcepts = collectMatchedConcepts(replyText, architectureConcepts)
	const matchedVerificationConcepts = collectMatchedConcepts(replyText, verificationConcepts)
	const missingHiddenRequirements = hiddenRequirements.filter((requirement) => !requirement.coveredByResponse)
	const matchedHiddenRequirements = collectMatchedConcepts(replyText, missingHiddenRequirements.map((requirement) => requirement.requirement))
	const needsArchitectureRecovery = gaps.some((gap) => gap.type === "architecture_drift" || gap.type === "temporal_drift" || gap.type === "profile_contradiction")
	const needsVerificationRecovery = gaps.some((gap) => gap.type === "constraint_omission") || verificationConcepts.length > 0

	const constraintScore =
		unsafeRewrite ? 0 : matchedProtectedConcepts.length > 0 || (scopeGuard && replyText.toLowerCase().includes("preserve")) ? 2 : 1
	const architectureScore =
		unsafeRewrite ? 0 : matchedArchitectureConcepts.length > 0 || scopeGuard ? 2 : 1
	const verificationScore = unsafeRewrite
		? 0
		: verificationConcepts.length === 0
			? 2
			: matchedVerificationConcepts.length >= Math.max(1, verificationConcepts.length - 1)
				? 2
				: matchedVerificationConcepts.length > 0
					? 1
					: 0

	const omissionTargets = [
		needsArchitectureRecovery ? "architecture" : null,
		needsVerificationRecovery ? "verification" : null,
		missingHiddenRequirements.length > 0 ? "hidden-requirements" : null,
	].filter((value): value is string => value !== null)
	let recoveredTargets = 0
	if (needsArchitectureRecovery && !unsafeRewrite && scopeGuard) recoveredTargets += 1
	if (needsVerificationRecovery && verificationScore > 0) recoveredTargets += 1
	if (missingHiddenRequirements.length > 0 && matchedHiddenRequirements.length > 0) recoveredTargets += 1
	const omissionScore =
		omissionTargets.length === 0 ? 2 : recoveredTargets >= omissionTargets.length ? 2 : recoveredTargets > 0 ? 1 : 0

	const boundednessScore = unsafeRewrite ? 0 : replyText.toLowerCase().includes("smallest safe next step") || replyText.toLowerCase().includes("only widen scope after") ? 2 : scopeGuard ? 1 : 0
	const clarityScore =
		unsafeRewrite
			? 0
			: (replyText.length <= 700 && (scopeGuard || matchedVerificationConcepts.length > 0) && matchedArchitectureConcepts.length > 0)
				? 2
				: 1

	return buildLaneScore(lane, dimensions, [
		{
			score: constraintScore,
			rationale:
				constraintScore === 2
					? `Keeps explicit constraints visible (${matchedProtectedConcepts.slice(0, 2).join(" | ") || "scope-guard phrasing"}).`
					: constraintScore === 1
						? "Does not contradict the stored constraints, but leaves them less explicit."
						: "Still pushes a broad rewrite or drops explicit constraint pressure.",
		},
		{
			score: architectureScore,
			rationale:
				architectureScore === 2
					? `Stays aligned to the requested architecture direction (${matchedArchitectureConcepts.slice(0, 2).join(" | ") || "bounded refactor avoidance"}).`
					: architectureScore === 1
						? "Avoids an obvious contradiction, but architecture direction is only weakly surfaced."
						: "Still widens scope into the kind of rewrite Balloon was meant to stop.",
		},
		{
			score: verificationScore,
			rationale:
				verificationScore === 2
					? `Carries verification forward (${matchedVerificationConcepts.slice(0, 3).join(" | ") || "verification stays explicit"}).`
					: verificationScore === 1
						? "Keeps some verification pressure alive, but leaves parts of it implicit."
						: "Still drops tests or other verification obligations that the profile said to keep visible.",
		},
		{
			score: omissionScore,
			rationale:
				omissionScore === 2
					? `Recovers the missing work Balloon flagged (${omissionTargets.join(" | ") || "no major omissions left"}).`
					: omissionScore === 1
						? `Recovers part of Balloon's missing-work signal, but not all of it (${omissionTargets.join(" | ")}).`
						: "Mostly polishes wording without recovering the missing follow-on work or drift correction.",
		},
		{
			score: boundednessScore,
			rationale:
				boundednessScore === 2
					? "Defines the smallest safe next step and explicitly resists widening scope early."
					: boundednessScore === 1
						? "Signals bounded change, but stops short of a fully explicit next-step boundary."
						: "Still leads with the bigger rewrite rather than the bounded recovery step.",
		},
		{
			score: clarityScore,
			rationale:
				clarityScore === 2
					? "Explains the correction in a way a maintainer could act on quickly."
					: clarityScore === 1
						? "Readable, but still a little generic or formulaic."
						: "Confusing or misleading enough that it would slow a maintainer down.",
		},
	])
}

function buildBenchmarkScorecard(
	store: BalloonStateStore,
	sessionId: string,
	options: BenchmarkLaneOptions,
): BalloonBenchmarkScorecard | null {
	const comparison = buildBenchmarkLaneComparison(store, sessionId, options)
	if (!comparison) return null
	const storedTurns = store.getTurns(sessionId, 5000)
	if (storedTurns.length === 0) return null
	const latestUserRequest = comparison.requestText || findLatestTurnContent(storedTurns, "user")
	const latestResponse = comparison.latestResponse ?? findLatestTurnContent(storedTurns, "assistant")
	if (!latestUserRequest || !latestResponse) return null
	const profile = buildStructuredProfile(sessionId, storedTurns)
	const hiddenRequirements = detectHiddenRequirements(latestUserRequest, latestResponse)
	const gaps = auditLatestTurn(sessionId, profile, latestResponse, latestUserRequest)
	const baseline = scoreLaneReply("baseline", comparison.baselineReply, profile, gaps, hiddenRequirements)
	const deterministic = scoreLaneReply("deterministic", comparison.deterministicReply, profile, gaps, hiddenRequirements)
	const assist = scoreLaneReply("assist", comparison.assistReply, profile, gaps, hiddenRequirements)
	const staged = scoreLaneReply("staged", comparison.stagedReply, profile, gaps, hiddenRequirements)
	const laneScores = [baseline, deterministic, assist, staged]
	const bestTotal = Math.max(...laneScores.map((lane) => lane.total))
	return {
		sessionId,
		dimensions: getBenchmarkScoreDimensions(),
		baseline,
		deterministic,
		assist,
		staged,
		topLanes: laneScores.filter((lane) => lane.total === bestTotal).map((lane) => lane.lane),
		deltas: {
			deterministicVsBaseline: deterministic.total - baseline.total,
			assistVsDeterministic: assist.total - deterministic.total,
			stagedVsDeterministic: staged.total - deterministic.total,
		},
	}
}

function emptyLaneTotals(): BalloonBenchmarkLaneTotals {
	return {
		baseline: 0,
		deterministic: 0,
		assist: 0,
		staged: 0,
		maxTotal: 0,
	}
}

function accumulateLaneTotals(target: BalloonBenchmarkLaneTotals, scorecard: BalloonBenchmarkScorecard): void {
	target.baseline += scorecard.baseline.total
	target.deterministic += scorecard.deterministic.total
	target.assist += scorecard.assist.total
	target.staged += scorecard.staged.total
	target.maxTotal += scorecard.baseline.maxTotal
}

function topLanesFromTotals(totals: BalloonBenchmarkLaneTotals): Array<BalloonBenchmarkLaneScore["lane"]> {
	const entries: Array<{ lane: BalloonBenchmarkLaneScore["lane"]; total: number }> = [
		{ lane: "baseline", total: totals.baseline },
		{ lane: "deterministic", total: totals.deterministic },
		{ lane: "assist", total: totals.assist },
		{ lane: "staged", total: totals.staged },
	]
	const bestTotal = Math.max(...entries.map((entry) => entry.total))
	return entries.filter((entry) => entry.total === bestTotal).map((entry) => entry.lane)
}

function buildLongSessionBenchmarkResult(
	store: BalloonStateStore,
	sessionId: string,
	options: BenchmarkLaneOptions & {
		turns?: Array<{ role: string; content: string; timestamp?: string }>
		mergeMode?: string | null
		checkpoints?: unknown
		checkpointMode?: unknown
	},
): LongSessionBenchmarkResult | null {
	const incomingTurns = options.turns ?? []
	if (incomingTurns.length > 0) {
		const mergeMode = options.mergeMode === "append" ? "append" : "replace"
		if (mergeMode === "replace") store.replaceTurns(sessionId, incomingTurns)
		else store.appendTurns(sessionId, incomingTurns)
	}
	const storedTurns = store.getTurns(sessionId, 5000)
	if (storedTurns.length === 0) return null
	const requestedCheckpoints = asPositiveIntArray(options.checkpoints, [10, 25, 50])
	const checkpointMode = parseCheckpointMode(options.checkpointMode)
	const checkpointSpecs = resolveCheckpointTurns(
		storedTurns.map((turn) => ({ role: turn.role, content: turn.content, timestamp: turn.timestamp })),
		requestedCheckpoints,
		checkpointMode,
	)
	if (checkpointSpecs.length === 0) return null
	const executedCheckpoints: LongSessionBenchmarkCheckpoint[] = []
	const pressureSnapshots: BalloonDriftPressureSnapshot[] = []
	for (const checkpoint of checkpointSpecs) {
		const checkpointTurns = storedTurns
			.slice(0, checkpoint.actualTurnCount)
			.map((turn) => ({ role: turn.role, content: turn.content, timestamp: turn.timestamp }))
		const checkpointSessionId = `${sessionId}__checkpoint_${checkpoint.actualTurnCount}`
		store.replaceTurns(checkpointSessionId, checkpointTurns)
		const comparison = buildBenchmarkLaneComparison(store, checkpointSessionId, {
			semanticAdapterPath: options.semanticAdapterPath,
			semanticTimeoutMs: options.semanticTimeoutMs,
			semanticMaxNotes: options.semanticMaxNotes,
			forceStageCount: options.forceStageCount,
			stageThresholds: options.stageThresholds,
		})
		if (!comparison) return null
		const pressureSnapshot = createDriftPressureSnapshot({
			sessionId: checkpointSessionId,
			source: "repair_packet",
			turnCount: checkpoint.actualTurnCount,
			requestText: comparison.requestText,
			latestResponse: comparison.latestResponse,
			pressure: comparison.deterministicDriftPressure,
		})
		store.saveDriftPressureSnapshot(pressureSnapshot)
		pressureSnapshots.push(pressureSnapshot)
		executedCheckpoints.push({
			checkpoint: checkpoint.checkpoint,
			actualTurnCount: checkpoint.actualTurnCount,
			checkpointSessionId,
			requestText: comparison.requestText,
			latestResponse: comparison.latestResponse,
			comparison,
			driftPressure: comparison.deterministicDriftPressure,
		})
	}
	return {
		sessionId,
		totalTurnCount: storedTurns.length,
		requestedCheckpoints,
		checkpointMode,
		executedCheckpoints,
		pressureHistory: summarizeDriftPressureHistory(sessionId, pressureSnapshots),
		forceStageCount: typeof options.forceStageCount === "number" && Number.isFinite(options.forceStageCount) ? Math.floor(options.forceStageCount) : null,
	}
}

function buildLongSessionBenchmarkScoreResult(
	store: BalloonStateStore,
	sessionId: string,
	options: BenchmarkLaneOptions & {
		turns?: Array<{ role: string; content: string; timestamp?: string }>
		mergeMode?: string | null
		checkpoints?: unknown
		checkpointMode?: unknown
	},
): LongSessionBenchmarkScoreResult | null {
	const benchmark = buildLongSessionBenchmarkResult(store, sessionId, options)
	if (!benchmark) return null
	const executedCheckpoints: LongSessionBenchmarkCheckpointScore[] = []
	const laneTotals = emptyLaneTotals()
	for (const checkpoint of benchmark.executedCheckpoints) {
		const scorecard = buildBenchmarkScorecard(store, checkpoint.checkpointSessionId, {
			semanticAdapterPath: options.semanticAdapterPath,
			semanticTimeoutMs: options.semanticTimeoutMs,
			semanticMaxNotes: options.semanticMaxNotes,
			forceStageCount: options.forceStageCount,
			stageThresholds: options.stageThresholds,
		})
		if (!scorecard) return null
		executedCheckpoints.push({
			checkpoint: checkpoint.checkpoint,
			actualTurnCount: checkpoint.actualTurnCount,
			checkpointSessionId: checkpoint.checkpointSessionId,
			scorecard,
			driftPressure: checkpoint.driftPressure,
		})
		accumulateLaneTotals(laneTotals, scorecard)
	}
	return {
		sessionId: benchmark.sessionId,
		totalTurnCount: benchmark.totalTurnCount,
		requestedCheckpoints: benchmark.requestedCheckpoints,
		checkpointMode: benchmark.checkpointMode,
		executedCheckpoints,
		pressureHistory: benchmark.pressureHistory,
		laneTotals,
		topLanes: topLanesFromTotals(laneTotals),
	}
}

function buildSlopCodeStarterSuiteSummary(
	store: BalloonStateStore,
	options: BenchmarkLaneOptions & {
		datasetRoot?: string | null
		problemNames?: string[]
	},
): SlopCodeStarterSuiteSummary {
	const datasetRoot = options.datasetRoot ?? undefined
	const plan = buildSlopCodeStarterBenchmarkPlan(datasetRoot)
	const selectedProblems = options.problemNames && options.problemNames.length > 0 ? new Set(options.problemNames) : null
	const evidenceSummary = buildSlopCodeEvidenceSummary(
		store,
		selectedProblems ? Array.from(selectedProblems) : plan.problems.map((problem) => problem.problemName),
	)
	const evidenceByProblem = new Map(evidenceSummary.problems.map((problem) => [problem.problemName, problem]))
	const problems = plan.problems
		.filter((problem) => (selectedProblems ? selectedProblems.has(problem.problemName) : true))
		.map((problem) => {
			const sessionTurns = store.getTurns(problem.recommendedSessionId, 5000)
			const warnings: string[] = []
			let scoreResult: LongSessionBenchmarkScoreResult | null = null
			if (sessionTurns.length === 0) {
				warnings.push("No stored turns found for the recommended session yet.")
			} else {
				scoreResult = buildLongSessionBenchmarkScoreResult(store, problem.recommendedSessionId, {
					semanticAdapterPath: options.semanticAdapterPath,
					semanticTimeoutMs: options.semanticTimeoutMs,
					semanticMaxNotes: options.semanticMaxNotes,
					forceStageCount: options.forceStageCount ?? problem.recommendedForceStageCount,
					stageThresholds: options.stageThresholds ?? problem.recommendedLongSessionThresholds,
					checkpoints: problem.recommendedCheckpointBatch,
					checkpointMode: problem.recommendedCheckpointMode,
				})
				if (!scoreResult) warnings.push("Stored session exists, but Balloon could not build a checkpointed score summary from it.")
			}
			return {
				problemName: problem.problemName,
				sessionId: problem.recommendedSessionId,
				recommendedCheckpoints: [...problem.recommendedCheckpointBatch],
				sessionPresent: sessionTurns.length > 0,
				executedCheckpoints: scoreResult ? scoreResult.executedCheckpoints.map((checkpoint) => checkpoint.actualTurnCount) : [],
				scoreResult,
				evidenceSummary:
					evidenceByProblem.get(problem.problemName) ??
					({
						problemName: problem.problemName,
						totalRuns: 0,
						liveRuns: 0,
						manualReplayRuns: 0,
						fixtureRuns: 0,
						syntheticDemoRuns: 0,
						coverage: "not_run",
						latestEvidenceKind: null,
						latestHost: null,
						latestProvider: null,
						latestModel: null,
						latestSessionId: null,
						latestRecordedAt: null,
						notes: ["No recorded evidence exists for this problem yet."],
						recentRuns: [],
					} satisfies BalloonSlopCodeProblemEvidenceSummary),
				warnings,
			}
		})
	const laneTotals = emptyLaneTotals()
	for (const problem of problems) {
		if (problem.scoreResult) {
			laneTotals.baseline += problem.scoreResult.laneTotals.baseline
			laneTotals.deterministic += problem.scoreResult.laneTotals.deterministic
			laneTotals.assist += problem.scoreResult.laneTotals.assist
			laneTotals.staged += problem.scoreResult.laneTotals.staged
			laneTotals.maxTotal += problem.scoreResult.laneTotals.maxTotal
		}
	}
	return {
		suiteName: `${plan.suiteName} Summary`,
		datasetStatus: plan.datasetStatus,
		totalProblems: problems.length,
		coveredProblems: problems.filter((problem) => problem.scoreResult !== null).length,
		laneTotals,
		topLanes: topLanesFromTotals(laneTotals),
		evidenceSummary,
		problems,
	}
}

function formatBenchmarkLaneScore(laneScore: BalloonBenchmarkLaneScore): string {
	return [
		`${laneScore.lane}: ${laneScore.total}/${laneScore.maxTotal}`,
		...laneScore.dimensionScores.map((score) => `- ${score.label}: ${score.score}/2 — ${score.rationale}`),
		`Summary: ${laneScore.summary}`,
	].join("\n")
}

function formatBenchmarkScorecard(scorecard: BalloonBenchmarkScorecard): string {
	return [
		`Session: ${scorecard.sessionId}`,
		`Top lane(s): ${scorecard.topLanes.join(", ")}`,
		`Deterministic vs baseline: ${scorecard.deltas.deterministicVsBaseline >= 0 ? "+" : ""}${scorecard.deltas.deterministicVsBaseline}`,
		`Assist vs deterministic: ${scorecard.deltas.assistVsDeterministic >= 0 ? "+" : ""}${scorecard.deltas.assistVsDeterministic}`,
		`Staged vs deterministic: ${scorecard.deltas.stagedVsDeterministic >= 0 ? "+" : ""}${scorecard.deltas.stagedVsDeterministic}`,
		"",
		formatBenchmarkLaneScore(scorecard.baseline),
		"",
		formatBenchmarkLaneScore(scorecard.deterministic),
		"",
		formatBenchmarkLaneScore(scorecard.assist),
		"",
		formatBenchmarkLaneScore(scorecard.staged),
	].join("\n")
}

function formatLongSessionBenchmarkScoreResult(result: LongSessionBenchmarkScoreResult): string {
	return [
		`Session: ${result.sessionId}`,
		`Total turns: ${result.totalTurnCount}`,
		`Requested checkpoints: ${result.requestedCheckpoints.join(", ")}`,
		`Checkpoint mode: ${result.checkpointMode}`,
		"",
		"Pressure history",
		formatDriftPressureHistory(result.pressureHistory),
		"",
		`Top lane(s): ${result.topLanes.join(", ")}`,
		`Baseline total: ${result.laneTotals.baseline}/${result.laneTotals.maxTotal}`,
		`Deterministic total: ${result.laneTotals.deterministic}/${result.laneTotals.maxTotal}`,
		`Assist total: ${result.laneTotals.assist}/${result.laneTotals.maxTotal}`,
		`Staged total: ${result.laneTotals.staged}/${result.laneTotals.maxTotal}`,
		"",
		...result.executedCheckpoints.flatMap((checkpoint, index) => [
			`Checkpoint ${index + 1}`,
			`Requested checkpoint: ${checkpoint.checkpoint}`,
			`Executed turn count: ${checkpoint.actualTurnCount}`,
			`Checkpoint session: ${checkpoint.checkpointSessionId}`,
			`Drift pressure: ${checkpoint.driftPressure.level} (${checkpoint.driftPressure.score}/100)`,
			formatBenchmarkScorecard(checkpoint.scorecard),
			"",
		]),
	].join("\n")
}

function formatSlopCodeStarterSuiteSummary(summary: SlopCodeStarterSuiteSummary): string {
	return [
		summary.suiteName,
		"",
		formatSlopCodeDatasetStatus(summary.datasetStatus),
		"",
		`Covered problems: ${summary.coveredProblems}/${summary.totalProblems}`,
		`Problems with live evidence: ${summary.evidenceSummary.liveCoveredProblems}/${summary.totalProblems}`,
		`Top lane(s): ${summary.topLanes.join(", ") || "none"}`,
		`Baseline total: ${summary.laneTotals.baseline}/${summary.laneTotals.maxTotal}`,
		`Deterministic total: ${summary.laneTotals.deterministic}/${summary.laneTotals.maxTotal}`,
		`Assist total: ${summary.laneTotals.assist}/${summary.laneTotals.maxTotal}`,
		`Staged total: ${summary.laneTotals.staged}/${summary.laneTotals.maxTotal}`,
		"",
		"Evidence risks",
		...(summary.evidenceSummary.openRisks.length > 0
			? summary.evidenceSummary.openRisks.map((risk, index) => `${index + 1}. ${risk}`)
			: ["None recorded."]),
		"",
		...summary.problems.flatMap((problem, index) => [
			`${index + 1}. ${problem.problemName}`,
			`Session id: ${problem.sessionId}`,
			`Session present: ${problem.sessionPresent ? "yes" : "no"}`,
			`Recommended checkpoints: ${problem.recommendedCheckpoints.join(", ")}`,
			`Executed checkpoints: ${problem.executedCheckpoints.length > 0 ? problem.executedCheckpoints.join(", ") : "none"}`,
			`Evidence coverage: ${problem.evidenceSummary.coverage}`,
			`Evidence runs: ${problem.evidenceSummary.totalRuns}`,
			`Live runs: ${problem.evidenceSummary.liveRuns}`,
			...(problem.scoreResult
				? [
						`Top lane(s): ${problem.scoreResult.topLanes.join(", ")}`,
						`Baseline total: ${problem.scoreResult.laneTotals.baseline}/${problem.scoreResult.laneTotals.maxTotal}`,
						`Deterministic total: ${problem.scoreResult.laneTotals.deterministic}/${problem.scoreResult.laneTotals.maxTotal}`,
						`Assist total: ${problem.scoreResult.laneTotals.assist}/${problem.scoreResult.laneTotals.maxTotal}`,
						`Staged total: ${problem.scoreResult.laneTotals.staged}/${problem.scoreResult.laneTotals.maxTotal}`,
						...formatPressureSummaryBlock(buildArtifactPressureSummary(problem.scoreResult)),
					]
				: ["Score summary: not available yet"]),
			...(problem.evidenceSummary.notes.length > 0
				? problem.evidenceSummary.notes.map((note, noteIndex) => `Evidence note ${noteIndex + 1}: ${note}`)
				: []),
			...(problem.warnings.length > 0 ? problem.warnings.map((warning, warningIndex) => `Warning ${warningIndex + 1}: ${warning}`) : []),
			"",
		]),
	].join("\n")
}

const SLOPCODE_EVIDENCE_KINDS: BalloonSlopCodeEvidenceKind[] = ["live_llm", "manual_replay", "fixture", "synthetic_demo"]
const SLOPCODE_TRANSCRIPT_SOURCES: BalloonSlopCodeTranscriptSource[] = ["live_host_session", "pasted_turns", "fixture_turns", "generated_demo"]
const SLOPCODE_DATASET_VERIFICATION_STATUSES: SlopCodeDatasetVerificationStatus[] = ["verified", "partial", "missing"]

function parseSlopCodeEvidenceKind(value: unknown): BalloonSlopCodeEvidenceKind | null {
	if (typeof value !== "string") return null
	return SLOPCODE_EVIDENCE_KINDS.find((entry) => entry === value.trim()) ?? null
}

function parseSlopCodeTranscriptSource(value: unknown): BalloonSlopCodeTranscriptSource | null {
	if (typeof value !== "string") return null
	return SLOPCODE_TRANSCRIPT_SOURCES.find((entry) => entry === value.trim()) ?? null
}

function parseSlopCodeDatasetVerificationStatus(value: unknown): SlopCodeDatasetVerificationStatus | null {
	if (typeof value !== "string") return null
	return SLOPCODE_DATASET_VERIFICATION_STATUSES.find((entry) => entry === value.trim()) ?? null
}

function formatSlopCodeRunEvidence(evidence: BalloonSlopCodeRunEvidence): string {
	return [
		`Problem: ${evidence.problemName}`,
		`Session: ${evidence.sessionId}`,
		`Evidence kind: ${evidence.evidenceKind}`,
		`Transcript source: ${evidence.transcriptSource}`,
		`Host: ${evidence.host ?? "unspecified"}`,
		`Provider: ${evidence.provider ?? "unspecified"}`,
		`Model: ${evidence.model ?? "unspecified"}`,
		`Dataset root: ${evidence.datasetRoot ?? "unspecified"}`,
		`Dataset verification: ${evidence.datasetVerificationStatus ?? "unspecified"}`,
		`Checkpoint mode: ${evidence.checkpointMode ?? "unspecified"}`,
		`Checkpoints: ${evidence.checkpoints.length > 0 ? evidence.checkpoints.join(", ") : "none"}`,
		`Recorded: ${evidence.recordedAt}`,
		...(evidence.notes.length > 0 ? ["Notes", ...evidence.notes.map((note, index) => `${index + 1}. ${note}`)] : []),
	].join("\n")
}

function buildSlopCodeEvidenceSummary(store: BalloonStateStore, problemNames?: string[]): BalloonSlopCodeEvidenceSummary {
	const requestedProblems = problemNames && problemNames.length > 0 ? problemNames : getSlopCodeStarterSuiteEntries().map((entry) => entry.problemName)
	const problems = Array.from(new Set(requestedProblems))
	const allRuns = store.listSlopCodeRunEvidence(undefined, 400)
	const filteredRuns = allRuns.filter((run) => problems.includes(run.problemName))

	const problemSummaries: BalloonSlopCodeProblemEvidenceSummary[] = problems.map((problemName) => {
		const runs = filteredRuns.filter((run) => run.problemName === problemName).sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
		const latest = runs[0] ?? null
		const liveRuns = runs.filter((run) => run.evidenceKind === "live_llm").length
		const manualReplayRuns = runs.filter((run) => run.evidenceKind === "manual_replay").length
		const fixtureRuns = runs.filter((run) => run.evidenceKind === "fixture").length
		const syntheticDemoRuns = runs.filter((run) => run.evidenceKind === "synthetic_demo").length
		const coverage: BalloonSlopCodeEvidenceCoverage = runs.length === 0 ? "not_run" : liveRuns > 0 ? "live" : "non_live_only"
		const notes: string[] = []
		if (coverage === "not_run") notes.push("No recorded evidence exists for this problem yet.")
		else if (coverage === "non_live_only") notes.push("Only non-live evidence is recorded so far; do not treat this as a true benchmark result yet.")
		if (latest?.datasetVerificationStatus === "missing" || latest?.datasetVerificationStatus === "partial") {
			notes.push(`Latest dataset verification is only ${latest.datasetVerificationStatus}.`)
		}
		if (latest?.evidenceKind === "live_llm" && latest.host && latest.model) {
			notes.push(`Latest live evidence came from ${latest.host} using ${latest.model}.`)
		}
		if (latest?.evidenceKind === "live_llm" && latest.transcriptSource !== "live_host_session") {
			notes.push("Latest live evidence was backfilled from turns instead of being captured directly from a live host session.")
		}
		return {
			problemName,
			totalRuns: runs.length,
			liveRuns,
			manualReplayRuns,
			fixtureRuns,
			syntheticDemoRuns,
			coverage,
			latestEvidenceKind: latest?.evidenceKind ?? null,
			latestHost: latest?.host ?? null,
			latestProvider: latest?.provider ?? null,
			latestModel: latest?.model ?? null,
			latestSessionId: latest?.sessionId ?? null,
			latestRecordedAt: latest?.recordedAt ?? null,
			notes,
			recentRuns: runs.slice(0, 5),
		}
	})

	const liveCoveredProblems = problemSummaries.filter((problem) => problem.coverage === "live").length
	const openRisks: string[] = []
	const missingLive = problemSummaries.filter((problem) => problem.coverage !== "live").map((problem) => problem.problemName)
	if (missingLive.length > 0) openRisks.push(`No live LLM evidence yet for: ${missingLive.join(", ")}.`)
	if (problemSummaries.some((problem) => problem.recentRuns.some((run) => run.datasetVerificationStatus === "missing"))) {
		openRisks.push("At least one recorded SCBench run used a dataset root that was not verified.")
	}
	if (problemSummaries.some((problem) => problem.coverage === "non_live_only")) {
		openRisks.push("Some SCBench evidence is still replay/demo-only, so benchmark claims must stay modest.")
	}
	if (problemSummaries.some((problem) => problem.recentRuns.some((run) => run.evidenceKind === "live_llm" && run.transcriptSource !== "live_host_session"))) {
		openRisks.push("At least one run marked live_llm was backfilled from turns instead of being captured directly from a live host session.")
	}

	return {
		suiteName: "Balloon SlopCodeBench Evidence",
		totalRuns: filteredRuns.length,
		liveRuns: filteredRuns.filter((run) => run.evidenceKind === "live_llm").length,
		manualReplayRuns: filteredRuns.filter((run) => run.evidenceKind === "manual_replay").length,
		fixtureRuns: filteredRuns.filter((run) => run.evidenceKind === "fixture").length,
		syntheticDemoRuns: filteredRuns.filter((run) => run.evidenceKind === "synthetic_demo").length,
		coveredProblems: problemSummaries.filter((problem) => problem.totalRuns > 0).length,
		liveCoveredProblems,
		problems: problemSummaries,
		openRisks,
	}
}

function formatSlopCodeEvidenceSummary(summary: BalloonSlopCodeEvidenceSummary): string {
	return [
		summary.suiteName,
		"",
		`Total runs: ${summary.totalRuns}`,
		`Live runs: ${summary.liveRuns}`,
		`Manual replay runs: ${summary.manualReplayRuns}`,
		`Fixture runs: ${summary.fixtureRuns}`,
		`Synthetic demo runs: ${summary.syntheticDemoRuns}`,
		`Covered problems: ${summary.coveredProblems}/${summary.problems.length}`,
		`Problems with live evidence: ${summary.liveCoveredProblems}/${summary.problems.length}`,
		"",
		"Open risks",
		...(summary.openRisks.length > 0 ? summary.openRisks.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
		"",
		...summary.problems.flatMap((problem, index) => [
			`${index + 1}. ${problem.problemName}`,
			`Coverage: ${problem.coverage}`,
			`Total runs: ${problem.totalRuns}`,
			`Live runs: ${problem.liveRuns}`,
			`Latest kind: ${problem.latestEvidenceKind ?? "none"}`,
			`Latest model: ${problem.latestModel ?? "none"}`,
			...(problem.notes.length > 0 ? problem.notes.map((note, noteIndex) => `Note ${noteIndex + 1}: ${note}`) : []),
			"",
		]),
	].join("\n")
}

function buildSlopCodeLiveRunPacket(options: {
	problemName?: unknown
	host?: unknown
	sessionId?: unknown
	datasetRoot?: unknown
	provider?: unknown
	model?: unknown
}): BalloonSlopCodeLiveRunPacket | null {
	const problemName = asString(options.problemName)
	if (!problemName) return null
	const preparation = buildSlopCodeProblemPreparation(problemName, asString(options.datasetRoot) ?? undefined)
	if (!preparation) return null
	const host = parseHostKind(options.host)
	const hostSurface = getHostSurface(host)
	const sessionId = asString(options.sessionId) ?? preparation.recommendedSessionId
	const provider = asString(options.provider)
	const model = asString(options.model)
	const datasetRoot = asString(options.datasetRoot)
	const datasetStatus = preparation.datasetStatus
	const warnings: string[] = []
	if (datasetStatus.verificationStatus !== "verified") {
		warnings.push(`Dataset verification is ${datasetStatus.verificationStatus}, so a live run should not be presented as fully verified benchmark evidence yet.`)
	}
	if (hostSurface.readinessTier !== "recommended_first") {
		warnings.push(`${hostSurface.displayName} is currently ${hostSurface.status}, so repeat the live rerun carefully and keep the host evidence notes explicit.`)
	}

	const recordEvidenceArgs: Record<string, unknown> = {
		problemName,
		sessionId,
		evidenceKind: "live_llm",
		transcriptSource: "live_host_session",
		host,
		checkpointMode: preparation.recommendedCheckpointMode,
		checkpoints: preparation.entry.recommendedCheckpointBatch,
	}
	if (provider) recordEvidenceArgs.provider = provider
	if (model) recordEvidenceArgs.model = model
	if (datasetRoot) recordEvidenceArgs.datasetRoot = datasetRoot

	return {
		problemName,
		host,
		hostDisplayName: hostSurface.displayName,
		sessionId,
		provider,
		model,
		datasetStatus,
		problemPreparation: preparation,
		evidenceTarget: {
			evidenceKind: "live_llm",
			transcriptSource: "live_host_session",
			host,
			provider,
			model,
			checkpointMode: preparation.recommendedCheckpointMode,
			checkpoints: [...preparation.entry.recommendedCheckpointBatch],
		},
		validationResourceUri: `balloon://hosts/${host}/validation-suite`,
		evidenceResourceUri: `balloon://benchmark/slopcode/evidence/${problemName}`,
		docsPath: hostSurface.docsPath,
		warnings,
		claimBoundary: [
			"Only call the run live_llm if it came from a real host-connected model session.",
			"Replaying pasted turns is useful, but it belongs under manual_replay instead of live_llm.",
			"Do not claim a full benchmark win until the dataset is verified and multiple live reruns exist.",
		],
		steps: [
			{
				stepId: "dataset_verify",
				title: "Verify dataset snapshot",
				goal: "Check that the local SlopCodeBench snapshot is present and still looks like the expected upstream dataset.",
				toolName: "balloon_describe_slopcode_starter_suite",
				toolArgs: datasetRoot ? { datasetRoot } : {},
				notes: [
					"Use the CLI dataset verifiers before making stronger benchmark claims.",
					"Treat zip-style snapshots without commit pinning as weaker evidence than a verified clone.",
				],
			},
			{
				stepId: "host_validate",
				title: "Sanity-check the MCP host",
				goal: "Make sure the chosen host is healthy before you trust the live rerun.",
				toolName: "balloon_prepare_host_validation_suite",
				toolArgs: {
					host,
					sessionId,
					userRequest: preparation.suggestedCompareBenchmarkPrompt,
				},
				notes: [
					`Read ${hostSurface.docsPath} and use ${hostSurface.recommendedFirstTools.join(", ")} before prompt-heavy flows.`,
					"Prefer a fresh chat after restarting the host if anything feels stale.",
				],
			},
			{
				stepId: "problem_prepare",
				title: "Prepare the problem packet",
				goal: "Load the checkpoint files, recommended session id, and scoring focus for the target SCBench problem.",
				toolName: "balloon_prepare_slopcode_problem",
				toolArgs: datasetRoot ? { problemName, datasetRoot } : { problemName },
				notes: [
					"Keep the recommended session id stable across the live run, scoring step, and evidence record.",
				],
			},
			{
				stepId: "live_run",
				title: "Run the live host session",
				goal: "Execute the problem in the real host/model session using the checkpoint sequence instead of a replay.",
				toolName: "balloon_compare_benchmark_lanes",
				toolArgs: {
					sessionId,
					userRequest: "<paste the latest live checkpoint request here>",
					semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
					forceStageCount: preparation.entry.recommendedForceStageCount,
					stageThresholds: preparation.entry.recommendedLongSessionThresholds,
				},
				notes: [
					"Paste the real live checkpoint turns into the same session instead of fabricating them afterward.",
					"Keep the change bounded to the benchmark checkpoint you are actually running.",
				],
			},
			{
				stepId: "score",
				title: "Score the checkpoint batch",
				goal: "Run the standard Balloon scoring path across the opening, middle, and late checkpoints.",
				toolName: "balloon_score_long_session_benchmark",
				toolArgs: {
					sessionId,
					checkpoints: preparation.entry.recommendedCheckpointBatch,
					checkpointMode: preparation.recommendedCheckpointMode,
					semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
					forceStageCount: preparation.entry.recommendedForceStageCount,
					stageThresholds: preparation.entry.recommendedLongSessionThresholds,
				},
				notes: [
					"For SCBench starter runs, the checkpoint numbers are assistant-turn ordinals.",
				],
			},
			{
				stepId: "record_evidence",
				title: "Record live evidence",
				goal: "Mark the rerun as truly live with host/model metadata instead of leaving it as an implicit chat memory.",
				toolName: "balloon_record_slopcode_run_evidence",
				toolArgs: recordEvidenceArgs,
				notes: [
					"If the session was not truly live, change evidenceKind before recording it.",
				],
			},
			{
				stepId: "export_artifacts",
				title: "Export the benchmark bundle",
				goal: "Write JSON and Markdown artifacts that carry score, pressure, and evidence coverage together.",
				toolName: "balloon_export_slopcode_starter_artifacts",
				toolArgs: {
					problemNames: [problemName],
					semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
					forceStageCount: preparation.entry.recommendedForceStageCount,
					stageThresholds: preparation.entry.recommendedLongSessionThresholds,
				},
				notes: [
					"The export bundle should now show whether the rerun is truly live or still replay/demo only.",
				],
			},
		],
	}
}

function formatSlopCodeLiveRunPacket(packet: BalloonSlopCodeLiveRunPacket): string {
	return [
		`Problem: ${packet.problemName}`,
		`Host: ${packet.hostDisplayName} (${packet.host})`,
		`Session id: ${packet.sessionId}`,
		`Provider: ${packet.provider ?? "unspecified"}`,
		`Model: ${packet.model ?? "unspecified"}`,
		"",
		"Dataset status",
		formatSlopCodeDatasetStatus(packet.datasetStatus),
		"",
		`Evidence target: ${packet.evidenceTarget.evidenceKind} via ${packet.evidenceTarget.transcriptSource}`,
		`Checkpoint mode: ${packet.evidenceTarget.checkpointMode}`,
		`Checkpoints: ${packet.evidenceTarget.checkpoints.join(", ")}`,
		`Host validation resource: ${packet.validationResourceUri}`,
		`Evidence resource: ${packet.evidenceResourceUri}`,
		`Host docs: ${packet.docsPath}`,
		"",
		"Warnings",
		...(packet.warnings.length > 0 ? packet.warnings.map((warning, index) => `${index + 1}. ${warning}`) : ["None recorded."]),
		"",
		"Claim boundary",
		...packet.claimBoundary.map((item, index) => `${index + 1}. ${item}`),
		"",
		"Steps",
		...packet.steps.flatMap((step, index) => [
			`${index + 1}. ${step.title}`,
			`Goal: ${step.goal}`,
			`Tool: ${step.toolName ?? "manual / CLI step"}`,
			...(step.notes.length > 0 ? step.notes.map((note, noteIndex) => `Note ${noteIndex + 1}: ${note}`) : []),
		]),
	].join("\n")
}

function buildSlopCodeLiveRunBatchPacket(options: {
	host?: unknown
	problemNames?: unknown
	sessionIdPrefix?: unknown
	datasetRoot?: unknown
	provider?: unknown
	model?: unknown
}): BalloonSlopCodeLiveRunBatchPacket {
	const host = parseHostKind(options.host)
	const hostSurface = getHostSurface(host)
	const requestedProblems = asStringArray(options.problemNames)
	const starterProblems = getSlopCodeStarterSuiteEntries().map((entry) => entry.problemName)
	const selectedProblems = requestedProblems.length > 0 ? requestedProblems.filter((problemName) => starterProblems.includes(problemName)) : starterProblems
	const sessionIdPrefix = asString(options.sessionIdPrefix)
	const datasetRoot = asString(options.datasetRoot)
	const provider = asString(options.provider)
	const model = asString(options.model)
	const datasetStatus = getSlopCodeDatasetStatus(datasetRoot)
	const warnings: string[] = []
	if (requestedProblems.length > 0) {
		const ignoredProblems = requestedProblems.filter((problemName) => !starterProblems.includes(problemName))
		if (ignoredProblems.length > 0) warnings.push(`Ignored unknown starter-suite problem names: ${ignoredProblems.join(", ")}.`)
	}
	if (datasetStatus.verificationStatus !== "verified") {
		warnings.push(`Dataset verification is ${datasetStatus.verificationStatus}, so this batch should be treated as provisional until the dataset root is fully verified.`)
	}
	if (hostSurface.readinessTier !== "recommended_first") {
		warnings.push(`${hostSurface.displayName} is still ${hostSurface.status}, so repeat the batch carefully and keep the host validation notes explicit.`)
	}
	const packets = selectedProblems
		.map((problemName) =>
			buildSlopCodeLiveRunPacket({
				problemName,
				host,
				sessionId: sessionIdPrefix ? `${sessionIdPrefix}-${problemName.replace(/_/g, "-")}` : undefined,
				datasetRoot,
				provider,
				model,
			}),
		)
		.filter((packet): packet is BalloonSlopCodeLiveRunPacket => packet !== null)

	return {
		host,
		hostDisplayName: hostSurface.displayName,
		sessionIdPrefix,
		provider,
		model,
		datasetStatus,
		totalProblems: packets.length,
		selectedProblems: packets.map((packet) => packet.problemName),
		warnings: uniqueStrings(warnings),
		nextActions: [
			`Run the batch in ${hostSurface.displayName} one problem at a time using the generated session ids.`,
			"Record each rerun with balloon_record_slopcode_run_evidence immediately after scoring.",
			"Export the starter-suite artifacts after the batch so the evidence coverage and pressure traces land in one bundle.",
		],
		packets,
	}
}

function formatSlopCodeLiveRunBatchPacket(batch: BalloonSlopCodeLiveRunBatchPacket): string {
	return [
		`Host: ${batch.hostDisplayName} (${batch.host})`,
		`Problems: ${batch.selectedProblems.join(", ") || "none"}`,
		`Session prefix: ${batch.sessionIdPrefix ?? "none"}`,
		`Provider: ${batch.provider ?? "unspecified"}`,
		`Model: ${batch.model ?? "unspecified"}`,
		"",
		"Dataset status",
		formatSlopCodeDatasetStatus(batch.datasetStatus),
		"",
		"Warnings",
		...(batch.warnings.length > 0 ? batch.warnings.map((warning, index) => `${index + 1}. ${warning}`) : ["None recorded."]),
		"",
		"Next actions",
		...batch.nextActions.map((action, index) => `${index + 1}. ${action}`),
		"",
		"Problem packets",
		...batch.packets.flatMap((packet, index) => [
			`${index + 1}. ${packet.problemName}`,
			`Session id: ${packet.sessionId}`,
			`Evidence target: ${packet.evidenceTarget.evidenceKind} via ${packet.evidenceTarget.transcriptSource}`,
			`Checkpoints: ${packet.evidenceTarget.checkpoints.join(", ")}`,
			`Evidence resource: ${packet.evidenceResourceUri}`,
			`Warnings: ${packet.warnings.length > 0 ? packet.warnings.join(" | ") : "none"}`,
		]),
	].join("\n")
}

function buildSlopCodeLiveRunPlaybook(): JsonRecord {
	const starterSuite = buildSlopCodeStarterSuite()
	return {
		title: "Balloon SlopCodeBench Live Run Playbook",
		summary: "Use this playbook when you want true live SCBench evidence instead of replay-only or synthetic benchmark traces.",
		requiredTools: [
			"balloon_prepare_slopcode_live_run_packet",
			"balloon_prepare_slopcode_problem",
			"balloon_score_long_session_benchmark",
			"balloon_record_slopcode_run_evidence",
			"balloon_export_slopcode_starter_artifacts",
		],
		resourcePointers: [
			"balloon://benchmark/slopcode/starter-suite",
			"balloon://benchmark/slopcode/starter-suite/runbook",
			"balloon://benchmark/slopcode/live-run-batch",
			"balloon://benchmark/slopcode/evidence",
		],
		hosts: getHostSurfaceCatalog().map((surface) => ({
			host: surface.host,
			displayName: surface.displayName,
			readinessTier: surface.readinessTier,
			status: surface.status,
			docsPath: surface.docsPath,
		})),
		problems: starterSuite.entries.map((entry) => ({
			problemName: entry.problemName,
			checkpoints: entry.recommendedCheckpointBatch,
			checkpointCount: entry.checkpointCount,
			forceStageCount: entry.recommendedForceStageCount,
			longSessionThresholds: entry.recommendedLongSessionThresholds,
		})),
		claimBoundary: [
			"Do not call a run live_llm unless it came from a real host-connected model session.",
			"Use manual_replay, fixture, or synthetic_demo when the turns were reconstructed or generated.",
			"Keep the exported bundle and evidence ledger aligned before making public benchmark claims.",
		],
	} satisfies JsonRecord
}

function formatProblemEvidenceSummaryBlock(summary: BalloonSlopCodeProblemEvidenceSummary): string[] {
	return [
		`Evidence coverage: ${summary.coverage}`,
		`Evidence runs: ${summary.totalRuns}`,
		`Live runs: ${summary.liveRuns}`,
		`Manual replay runs: ${summary.manualReplayRuns}`,
		`Fixture runs: ${summary.fixtureRuns}`,
		`Synthetic demo runs: ${summary.syntheticDemoRuns}`,
		`Latest evidence kind: ${summary.latestEvidenceKind ?? "none"}`,
		`Latest host: ${summary.latestHost ?? "none"}`,
		`Latest model: ${summary.latestModel ?? "none"}`,
	]
}

function collectProblemEvidenceAlerts(summary: BalloonSlopCodeProblemEvidenceSummary): string[] {
	return uniqueStrings([
		...(summary.coverage === "not_run" ? ["No recorded evidence exists for this problem yet."] : []),
		...(summary.coverage === "non_live_only" ? ["Only non-live evidence is recorded so far; do not treat this as a true benchmark result yet."] : []),
		...summary.notes,
	])
}

type StarterSuiteArtifactProblemExport = {
	problemName: string
	sessionId: string
	sessionPresent: boolean
	covered: boolean
	evidenceSummary: BalloonSlopCodeProblemEvidenceSummary
	evidenceAlerts: string[]
	executedCheckpoints: number[]
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
	laneTotals: BalloonBenchmarkLaneTotals | null
	pressureHistory: BalloonDriftPressureHistorySummary | null
	pressureAlerts: string[]
	highPressureCheckpoints: number[]
	warnings: string[]
	regressions: string[]
	jsonPath: string
	markdownPath: string
}

type StarterSuiteArtifactExportBundle = {
	suiteName: string
	outputDir: string
	problemsDir: string
	generatedAt: string
	datasetStatus: SlopCodeStarterSuiteSummary["datasetStatus"]
	totalProblems: number
	coveredProblems: number
	evidenceSummary: BalloonSlopCodeEvidenceSummary
	evidenceAlerts: string[]
	laneTotals: BalloonBenchmarkLaneTotals
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
	pressureAlerts: string[]
	regressions: string[]
	summaryJsonPath: string
	summaryMarkdownPath: string
	problems: StarterSuiteArtifactProblemExport[]
}

type StarterSuiteArtifactPressureSummary = {
	trend: BalloonDriftPressureHistorySummary["trend"]
	latestLevel: BalloonDriftPressureHistorySummary["latestLevel"]
	latestScore: number | null
	peakScore: number | null
	averageScore: number | null
	highPressureCheckpoints: number[]
	lowPressureCheckpoints: number[]
}

function makeArtifactStamp(): string {
	return new Date().toISOString().replace(/:/g, "-").replace(/\.\d{3}Z$/u, "Z")
}

function safeArtifactName(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+/g, "")
		.replace(/-+$/g, "") || "artifact"
}

function resolveArtifactOutputDir(requestedOutputDir?: string | null): string {
	if (requestedOutputDir && requestedOutputDir.trim().length > 0) {
		return path.resolve(process.cwd(), requestedOutputDir.trim())
	}
	return path.resolve(process.cwd(), "benchmark_artifacts", "slopcode_starter_suite", makeArtifactStamp())
}

function ensureArtifactDir(dirPath: string): void {
	fs.mkdirSync(dirPath, { recursive: true })
}

function collectLaneRegressions(laneTotals: BalloonBenchmarkLaneTotals): string[] {
	const notes: string[] = []
	if (laneTotals.assist < laneTotals.deterministic) {
		notes.push(`Assist trailed deterministic by ${laneTotals.deterministic - laneTotals.assist} point(s).`)
	}
	if (laneTotals.staged < laneTotals.deterministic) {
		notes.push(`Staged trailed deterministic by ${laneTotals.deterministic - laneTotals.staged} point(s).`)
	}
	if (laneTotals.assist < laneTotals.baseline) {
		notes.push(`Assist fell below baseline by ${laneTotals.baseline - laneTotals.assist} point(s).`)
	}
	if (laneTotals.staged < laneTotals.baseline) {
		notes.push(`Staged fell below baseline by ${laneTotals.baseline - laneTotals.staged} point(s).`)
	}
	return notes
}

function buildArtifactPressureSummary(scoreResult: LongSessionBenchmarkScoreResult | null): StarterSuiteArtifactPressureSummary | null {
	if (!scoreResult) return null
	return {
		trend: scoreResult.pressureHistory.trend,
		latestLevel: scoreResult.pressureHistory.latestLevel,
		latestScore: scoreResult.pressureHistory.latestScore,
		peakScore: scoreResult.pressureHistory.peakScore,
		averageScore: scoreResult.pressureHistory.averageScore,
		highPressureCheckpoints: scoreResult.executedCheckpoints
			.filter((checkpoint) => checkpoint.driftPressure.score >= 40 || checkpoint.driftPressure.level === "high" || checkpoint.driftPressure.level === "critical")
			.map((checkpoint) => checkpoint.actualTurnCount),
		lowPressureCheckpoints: scoreResult.executedCheckpoints
			.filter((checkpoint) => checkpoint.driftPressure.score < 18 && checkpoint.driftPressure.level === "low")
			.map((checkpoint) => checkpoint.actualTurnCount),
	}
}

function collectPressureAlerts(summary: StarterSuiteArtifactPressureSummary | null): string[] {
	if (!summary) return []
	const notes: string[] = []
	if (summary.trend === "rising") notes.push("Pressure trend is rising across the scored checkpoints.")
	if (summary.trend === "falling") notes.push("Pressure trend is falling across the scored checkpoints.")
	if (summary.latestLevel === "high" || summary.latestLevel === "critical") notes.push(`Latest pressure is still ${summary.latestLevel} (${summary.latestScore ?? "unknown"}/100).`)
	if ((summary.peakScore ?? 0) >= 70) notes.push(`Peak pressure reached ${summary.peakScore}/100 during the checkpoint sequence.`)
	if ((summary.averageScore ?? 0) >= 45) notes.push(`Average pressure stayed elevated at ${summary.averageScore}/100.`)
	if (summary.highPressureCheckpoints.length > 0) notes.push(`High-pressure checkpoints: ${summary.highPressureCheckpoints.join(", ")}.`)
	if (notes.length === 0 && summary.lowPressureCheckpoints.length > 0) notes.push(`Low-pressure checkpoints: ${summary.lowPressureCheckpoints.join(", ")}.`)
	return notes
}

function formatPressureSummaryBlock(summary: StarterSuiteArtifactPressureSummary | null): string[] {
	if (!summary) return ["Pressure trace: not available yet"]
	return [
		`Pressure trend: ${summary.trend}`,
		`Latest pressure: ${summary.latestLevel ?? "none"} (${summary.latestScore ?? "none"}/100)`,
		`Peak pressure: ${summary.peakScore ?? "none"}`,
		`Average pressure: ${summary.averageScore ?? "none"}`,
		`High-pressure checkpoints: ${summary.highPressureCheckpoints.length > 0 ? summary.highPressureCheckpoints.join(", ") : "none"}`,
	]
}

function collectSuitePressureAlerts(problems: StarterSuiteArtifactProblemExport[]): string[] {
	const risingProblems = problems.filter((problem) => problem.pressureHistory?.trend === "rising").map((problem) => problem.problemName)
	const stuckProblems = problems
		.filter((problem) => problem.pressureHistory && ((problem.pressureHistory.latestLevel === "high" || problem.pressureHistory.latestLevel === "critical") || (problem.pressureHistory.averageScore ?? 0) >= 45))
		.map((problem) => problem.problemName)
	const notes: string[] = []
	if (risingProblems.length > 0) notes.push(`Rising pressure still appears in: ${risingProblems.join(", ")}.`)
	if (stuckProblems.length > 0) notes.push(`Elevated pressure still appears in: ${stuckProblems.join(", ")}.`)
	if (notes.length === 0 && problems.some((problem) => problem.covered)) notes.push("No rising or persistently elevated pressure was recorded in the exported starter problems.")
	return notes
}

function formatLaneTotalsBlock(laneTotals: BalloonBenchmarkLaneTotals | null): string[] {
	if (!laneTotals) return ["Lane totals: not available yet"]
	return [
		`Baseline total: ${laneTotals.baseline}/${laneTotals.maxTotal}`,
		`Deterministic total: ${laneTotals.deterministic}/${laneTotals.maxTotal}`,
		`Assist total: ${laneTotals.assist}/${laneTotals.maxTotal}`,
		`Staged total: ${laneTotals.staged}/${laneTotals.maxTotal}`,
	]
}

function formatStarterSuiteArtifactProblemMarkdown(options: {
	problem: SlopCodeStarterSuiteSummary["problems"][number]
	regressions: string[]
	pressureSummary: StarterSuiteArtifactPressureSummary | null
	pressureAlerts: string[]
	evidenceAlerts: string[]
	generatedAt: string
}): string {
	const { problem, regressions, pressureSummary, pressureAlerts, evidenceAlerts, generatedAt } = options
	return [
		`# SCBench Starter Artifact: ${problem.problemName}`,
		"",
		`Generated: ${generatedAt}`,
		`Session id: ${problem.sessionId}`,
		`Session present: ${problem.sessionPresent ? "yes" : "no"}`,
		`Recommended checkpoints: ${problem.recommendedCheckpoints.join(", ")}`,
		`Executed checkpoints: ${problem.executedCheckpoints.length > 0 ? problem.executedCheckpoints.join(", ") : "none"}`,
		"",
		"Totals",
		...formatLaneTotalsBlock(problem.scoreResult?.laneTotals ?? null),
		"",
		"Top lane(s)",
		problem.scoreResult?.topLanes.join(", ") || "none",
		"",
		"Evidence",
		...formatProblemEvidenceSummaryBlock(problem.evidenceSummary),
		"",
		"Evidence alerts",
		...(evidenceAlerts.length > 0 ? evidenceAlerts.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
		"",
		"Pressure trace",
		...formatPressureSummaryBlock(pressureSummary),
		"",
		"Pressure alerts",
		...(pressureAlerts.length > 0 ? pressureAlerts.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
		"",
		"Regressions",
		...(regressions.length > 0 ? regressions.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
		"",
		"Warnings",
		...(problem.warnings.length > 0 ? problem.warnings.map((warning, index) => `${index + 1}. ${warning}`) : ["None."]),
		"",
		problem.scoreResult ? formatLongSessionBenchmarkScoreResult(problem.scoreResult) : "No scored checkpoint sequence is available for this problem yet.",
	].join("\n")
}

function formatStarterSuiteArtifactSummaryMarkdown(bundle: StarterSuiteArtifactExportBundle): string {
	return [
		`# ${bundle.suiteName} Artifact Export`,
		"",
		`Generated: ${bundle.generatedAt}`,
		`Output directory: ${bundle.outputDir}`,
		"",
		formatSlopCodeDatasetStatus(bundle.datasetStatus),
		"",
		`Covered problems: ${bundle.coveredProblems}/${bundle.totalProblems}`,
		`Problems with live evidence: ${bundle.evidenceSummary.liveCoveredProblems}/${bundle.totalProblems}`,
		`Top lane(s): ${bundle.topLanes.join(", ") || "none"}`,
		...formatLaneTotalsBlock(bundle.laneTotals),
		"",
		"Evidence risks",
		...(bundle.evidenceAlerts.length > 0 ? bundle.evidenceAlerts.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
		"",
		"Suite pressure alerts",
		...(bundle.pressureAlerts.length > 0 ? bundle.pressureAlerts.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
		"",
		"Suite regressions",
		...(bundle.regressions.length > 0 ? bundle.regressions.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
		"",
		"Problem artifacts",
		...bundle.problems.flatMap((problem, index) => [
			`${index + 1}. ${problem.problemName}`,
			`Session id: ${problem.sessionId}`,
			`Covered: ${problem.covered ? "yes" : "no"}`,
			`Evidence coverage: ${problem.evidenceSummary.coverage}`,
			`JSON: ${problem.jsonPath}`,
			`Markdown: ${problem.markdownPath}`,
			`Top lane(s): ${problem.topLanes.join(", ") || "none"}`,
			...(problem.evidenceAlerts.length > 0 ? problem.evidenceAlerts.map((note, noteIndex) => `Evidence ${noteIndex + 1}: ${note}`) : []),
			...(problem.pressureAlerts.length > 0 ? problem.pressureAlerts.map((note, noteIndex) => `Pressure ${noteIndex + 1}: ${note}`) : []),
			...(problem.regressions.length > 0 ? problem.regressions.map((note, noteIndex) => `Regression ${noteIndex + 1}: ${note}`) : []),
			...(problem.warnings.length > 0 ? problem.warnings.map((warning, warningIndex) => `Warning ${warningIndex + 1}: ${warning}`) : []),
			"",
		]),
	].join("\n")
}

function buildStarterSuiteArtifactExport(
	store: BalloonStateStore,
	options: BenchmarkLaneOptions & {
		datasetRoot?: string | null
		problemNames?: string[]
		outputDir?: string | null
	},
): StarterSuiteArtifactExportBundle | null {
	const summary = buildSlopCodeStarterSuiteSummary(store, options)
	if (summary.coveredProblems === 0) return null

	const outputDir = resolveArtifactOutputDir(options.outputDir)
	const problemsDir = path.join(outputDir, "problems")
	const generatedAt = new Date().toISOString()
	ensureArtifactDir(problemsDir)

	const exportedProblems: StarterSuiteArtifactProblemExport[] = summary.problems.map((problem) => {
		const regressions = problem.scoreResult ? collectLaneRegressions(problem.scoreResult.laneTotals) : []
		const pressureSummary = buildArtifactPressureSummary(problem.scoreResult)
		const pressureAlerts = collectPressureAlerts(pressureSummary)
		const evidenceAlerts = collectProblemEvidenceAlerts(problem.evidenceSummary)
		const problemStem = safeArtifactName(problem.problemName)
		const jsonPath = path.join(problemsDir, `${problemStem}.json`)
		const markdownPath = path.join(problemsDir, `${problemStem}.md`)
		const payload = {
			generatedAt,
			problem,
			evidenceAlerts,
			pressureSummary,
			pressureAlerts,
			regressions,
		}
		fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
		fs.writeFileSync(
			markdownPath,
			`${formatStarterSuiteArtifactProblemMarkdown({ problem, regressions, pressureSummary, pressureAlerts, evidenceAlerts, generatedAt })}\n`,
			"utf8",
		)
		return {
			problemName: problem.problemName,
			sessionId: problem.sessionId,
			sessionPresent: problem.sessionPresent,
			covered: problem.scoreResult !== null,
			evidenceSummary: problem.evidenceSummary,
			evidenceAlerts,
			executedCheckpoints: problem.executedCheckpoints,
			topLanes: problem.scoreResult?.topLanes ?? [],
			laneTotals: problem.scoreResult?.laneTotals ?? null,
			pressureHistory: problem.scoreResult?.pressureHistory ?? null,
			pressureAlerts,
			highPressureCheckpoints: pressureSummary?.highPressureCheckpoints ?? [],
			warnings: problem.warnings,
			regressions,
			jsonPath,
			markdownPath,
		}
	})

	const regressions = collectLaneRegressions(summary.laneTotals)
	const pressureAlerts = collectSuitePressureAlerts(exportedProblems)
	const evidenceAlerts = uniqueStrings(summary.evidenceSummary.openRisks)
	const summaryJsonPath = path.join(outputDir, "summary.json")
	const summaryMarkdownPath = path.join(outputDir, "summary.md")
	const bundle: StarterSuiteArtifactExportBundle = {
		suiteName: summary.suiteName,
		outputDir,
		problemsDir,
		generatedAt,
		datasetStatus: summary.datasetStatus,
		totalProblems: summary.totalProblems,
		coveredProblems: summary.coveredProblems,
		evidenceSummary: summary.evidenceSummary,
		evidenceAlerts,
		laneTotals: summary.laneTotals,
		topLanes: summary.topLanes,
		pressureAlerts,
		regressions,
		summaryJsonPath,
		summaryMarkdownPath,
		problems: exportedProblems,
	}

	fs.writeFileSync(summaryJsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8")
	fs.writeFileSync(summaryMarkdownPath, `${formatStarterSuiteArtifactSummaryMarkdown(bundle)}\n`, "utf8")
	return bundle
}

const BALLOON_HOST_SURFACES: BalloonHostSurface[] = [
	{
		host: "vscode",
		displayName: "VS Code built-in MCP",
		readinessTier: "recommended_first",
		status: "best current path",
		configRoot: "servers",
		exampleConfigPath: "examples/vscode_mcp.example.json",
		docsPath: "docs/INSTALL.md",
		recommendedFirstTools: ["balloon_run_cycle", "balloon_repair_next_turn", "balloon_compare_benchmark_lanes"],
		promptSensitiveSurfaces: ["balloon/repair-next-turn", "balloon/review-session-drift"],
		restartHints: ["Restart the server entry after config changes.", "Start a fresh chat after the MCP server becomes healthy.", "If tools seem stale, use MCP: Reset Cached Tools."],
		knownCaveats: ["Prompt routing can still vary by chat state.", "Older chat tabs can keep stale MCP state after server changes."],
		notes: ["VS Code is the most exercised Balloon host path right now.", "The tool-first Balloon flows are the least fragile way to validate the install."],
	},
	{
		host: "cline",
		displayName: "Cline",
		readinessTier: "promising",
		status: "promising",
		configRoot: "mcpServers",
		exampleConfigPath: "examples/cline_mcp_settings.example.json",
		docsPath: "docs/CLINE_QUICKSTART.md",
		recommendedFirstTools: ["balloon_run_cycle", "balloon_repair_next_turn", "balloon_compare_benchmark_lanes"],
		promptSensitiveSurfaces: ["balloon/repair-next-turn", "balloon/review-session-drift"],
		restartHints: ["Restart the MCP server entry after config edits.", "Prefer a fresh chat after restarting Balloon.", "If tool lists look stale, restart Cline again."],
		knownCaveats: ["Absolute cwd paths are safer on Windows.", "Prompt routing is more host-sensitive than the tool-first flows."],
		notes: ["Cline has a real MCP surface that maps well to Balloon's tool-first flows.", "This host still needs more repeated validation than VS Code."],
	},
	{
		host: "roo_code",
		displayName: "Roo Code",
		readinessTier: "experimental",
		status: "experimental",
		configRoot: "mcpServers",
		exampleConfigPath: "examples/roo_mcp.example.json",
		docsPath: "docs/ROO_CODE_QUICKSTART.md",
		recommendedFirstTools: ["balloon_run_cycle", "balloon_repair_next_turn", "balloon_compare_benchmark_lanes"],
		promptSensitiveSurfaces: ["balloon/repair-next-turn", "balloon/review-session-drift"],
		restartHints: ["Restart the Balloon MCP entry after config edits.", "Start a fresh chat after restart.", "If tools appear stale, restart Roo again."],
		knownCaveats: ["Local MCP behavior has shifted across Roo releases.", "Absolute cwd paths are safer on Windows."],
		notes: ["Roo is meaningful for the long-term Balloon product vision.", "Treat the current setup as experimental until more real reruns exist."],
	},
	{
		host: "claude_desktop",
		displayName: "Claude Desktop-style JSON hosts",
		readinessTier: "manual",
		status: "manual but workable",
		configRoot: "mcpServers",
		exampleConfigPath: "examples/claude_desktop_config.example.json",
		docsPath: "docs/HOST_COMPATIBILITY.md",
		recommendedFirstTools: ["balloon_run_cycle", "balloon_repair_next_turn", "balloon_review_session_drift"],
		promptSensitiveSurfaces: ["balloon/repair-next-turn", "balloon/review-session-drift"],
		restartHints: ["Restart the host after config edits.", "Prefer a fresh chat after restart.", "Re-check command quoting and cwd if the server starts but tools fail."],
		knownCaveats: ["Path handling and quoting vary by host build.", "Manual adaptation may be needed even when the JSON shape looks similar."],
		notes: ["This bucket covers Claude Desktop-style JSON hosts and similar Claude/CLI MCP surfaces.", "Tool access and resource reads tend to be more reliable than prompt routing."],
	},
	{
		host: "generic_json",
		displayName: "Generic JSON MCP hosts",
		readinessTier: "manual",
		status: "manual but workable",
		configRoot: "mcpServers",
		exampleConfigPath: "examples/claude_desktop_config.example.json",
		docsPath: "docs/HOST_COMPATIBILITY.md",
		recommendedFirstTools: ["balloon_run_cycle", "balloon_repair_next_turn", "balloon_compare_benchmark_lanes"],
		promptSensitiveSurfaces: ["balloon/repair-next-turn", "balloon/review-session-drift"],
		restartHints: ["Restart the MCP entry after config edits.", "Use a fresh chat after restarting.", "If the host keeps stale tools, clear the host cache if supported."],
		knownCaveats: ["You may need to adapt cwd, args, and quoting manually.", "Use the validator before assuming the config is correct."],
		notes: ["This is the catch-all path for other stdio JSON hosts.", "Balloon's tool-first flows travel better across generic hosts than prompt-heavy flows."],
	},
]

function cloneHostSurface(surface: BalloonHostSurface): BalloonHostSurface {
	return {
		...surface,
		recommendedFirstTools: [...surface.recommendedFirstTools],
		promptSensitiveSurfaces: [...surface.promptSensitiveSurfaces],
		restartHints: [...surface.restartHints],
		knownCaveats: [...surface.knownCaveats],
		notes: [...surface.notes],
	}
}

function getHostSurfaceCatalog(): BalloonHostSurface[] {
	return BALLOON_HOST_SURFACES.map((surface) => cloneHostSurface(surface))
}

function getHostSurface(host: BalloonHostKind): BalloonHostSurface {
	return cloneHostSurface(BALLOON_HOST_SURFACES.find((surface) => surface.host === host) ?? BALLOON_HOST_SURFACES[0]!)
}

function resolveHostRepoPath(requestedRepoPath?: string | null): { repoPath: string; explicit: boolean } {
	if (requestedRepoPath && requestedRepoPath.trim().length > 0) {
		return { repoPath: path.resolve(process.cwd(), requestedRepoPath.trim()), explicit: true }
	}
	return { repoPath: process.cwd(), explicit: false }
}

function resolveHostStartLayout(repoPath: string): { startArg: string; resolvedStartPath: string | null; buildReady: boolean } {
	const candidates = [
		{
			marker: path.join(repoPath, "Ballon_architecture", "balloon_mcp_server", "src", "start.ts"),
			startArg: toPortablePath(path.join("dist", "Ballon_architecture", "balloon_mcp_server", "src", "start.js")),
			resolvedStartPath: path.join(repoPath, "dist", "Ballon_architecture", "balloon_mcp_server", "src", "start.js"),
		},
		{
			marker: path.join(repoPath, "src", "start.ts"),
			startArg: toPortablePath(path.join("dist", "src", "start.js")),
			resolvedStartPath: path.join(repoPath, "dist", "src", "start.js"),
		},
	]
	for (const candidate of candidates) {
		if (fs.existsSync(candidate.resolvedStartPath)) {
			return { startArg: candidate.startArg, resolvedStartPath: candidate.resolvedStartPath, buildReady: true }
		}
	}
	for (const candidate of candidates) {
		if (fs.existsSync(candidate.marker)) {
			return { startArg: candidate.startArg, resolvedStartPath: null, buildReady: false }
		}
	}
	return {
		startArg: toPortablePath(path.join("dist", "src", "start.js")),
		resolvedStartPath: null,
		buildReady: false,
	}
}

function buildHostArgs(options: {
	startArg: string
	dataDir: string
	semanticCaraMode?: string | null
	semanticCaraAdapter?: string | null
	semanticCaraTimeoutMs?: unknown
	semanticCaraMaxNotes?: unknown
}): string[] {
	const args = [options.startArg, "--data-dir", options.dataDir]
	const semanticCaraMode = asString(options.semanticCaraMode)
	if (semanticCaraMode && semanticCaraMode !== "off") {
		args.push("--semantic-cara-mode", semanticCaraMode)
		const semanticCaraAdapter = asString(options.semanticCaraAdapter)
		if (semanticCaraAdapter) args.push("--semantic-cara-adapter", semanticCaraAdapter)
		if (typeof options.semanticCaraTimeoutMs === "number" && Number.isFinite(options.semanticCaraTimeoutMs) && options.semanticCaraTimeoutMs > 0) {
			args.push("--semantic-cara-timeout-ms", String(Math.floor(options.semanticCaraTimeoutMs)))
		}
		if (typeof options.semanticCaraMaxNotes === "number" && Number.isFinite(options.semanticCaraMaxNotes) && options.semanticCaraMaxNotes > 0) {
			args.push("--semantic-cara-max-notes", String(Math.floor(options.semanticCaraMaxNotes)))
		}
	}
	return args.map((arg) => (arg.includes("\\") ? toPortablePath(arg) : arg))
}

function buildHostConfigSnippet(options: {
	host: BalloonHostSurface
	serverName: string
	command: string
	args: string[]
	cwd: string
}): string {
	const serverConfig: Record<string, unknown> =
		options.host.configRoot === "servers"
			? {
					type: "stdio",
					command: options.command,
					args: options.args,
					cwd: options.cwd,
				}
			: {
					command: options.command,
					args: options.args,
					cwd: options.cwd,
				}
	const payload =
		options.host.configRoot === "servers"
			? { servers: { [options.serverName]: serverConfig } }
			: { mcpServers: { [options.serverName]: serverConfig } }
	return JSON.stringify(payload, null, 2)
}

function buildHostSetupPacket(options: {
	host?: unknown
	repoPath?: unknown
	dataDir?: unknown
	serverName?: unknown
	preferWorkspaceVariable?: unknown
	semanticCaraMode?: unknown
	semanticCaraAdapter?: unknown
	semanticCaraTimeoutMs?: unknown
	semanticCaraMaxNotes?: unknown
}): BalloonHostSetupPacket {
	const host = parseHostKind(options.host)
	const surface = getHostSurface(host)
	const repoPathInfo = resolveHostRepoPath(asString(options.repoPath))
	const dataDir = toPortablePath(asString(options.dataDir) ?? ".balloon-mcp-demo")
	const serverName = asString(options.serverName) ?? "balloon-mcp"
	const startLayout = resolveHostStartLayout(repoPathInfo.repoPath)
	const preferWorkspaceVariable = typeof options.preferWorkspaceVariable === "boolean" ? options.preferWorkspaceVariable : true
	const cwd =
		host === "vscode" && preferWorkspaceVariable && !repoPathInfo.explicit ? "${workspaceFolder}" : toPortablePath(path.resolve(repoPathInfo.repoPath))
	const args = buildHostArgs({
		startArg: startLayout.startArg,
		dataDir,
		semanticCaraMode: asString(options.semanticCaraMode),
		semanticCaraAdapter: asString(options.semanticCaraAdapter),
		semanticCaraTimeoutMs: options.semanticCaraTimeoutMs,
		semanticCaraMaxNotes: options.semanticCaraMaxNotes,
	})
	const validationWarnings: string[] = []
	if (!startLayout.buildReady) validationWarnings.push("Built Balloon start.js was not found yet. Run npm install and npm run build before using this host config.")
	if (process.platform === "win32" && host !== "vscode") validationWarnings.push("On Windows, keep cwd as an absolute path for this host.")
	if (asString(options.semanticCaraMode) === "assist" && !asString(options.semanticCaraAdapter)) {
		validationWarnings.push("Assist mode needs --semantic-cara-adapter to be useful.")
	}
	return {
		host,
		displayName: surface.displayName,
		readinessTier: surface.readinessTier,
		status: surface.status,
		configRoot: surface.configRoot,
		repoPath: toPortablePath(path.resolve(repoPathInfo.repoPath)),
		command: "node",
		args,
		cwd,
		dataDir,
		resolvedStartPath: startLayout.resolvedStartPath ? toPortablePath(path.resolve(startLayout.resolvedStartPath)) : null,
		buildReady: startLayout.buildReady,
		configSnippet: buildHostConfigSnippet({
			host: surface,
			serverName,
			command: "node",
			args,
			cwd,
		}),
		exampleConfigPath: surface.exampleConfigPath,
		docsPath: surface.docsPath,
		recommendedFirstTools: [...surface.recommendedFirstTools],
		promptSensitiveSurfaces: [...surface.promptSensitiveSurfaces],
		restartHints: [...surface.restartHints],
		validationWarnings,
		firstRunChecklist: [
			"Run npm install if dependencies are not present yet.",
			"Run npm run build before connecting the host.",
			"Run npm run verify:balloon:mcp for a fast health check.",
			"Paste the config snippet into the host and restart the MCP entry.",
			`Use ${surface.recommendedFirstTools.join(", ")} before trying prompt-heavy flows.`,
		],
	}
}

function findConfigRootRecord(parsed: Record<string, unknown>, root: BalloonHostConfigRoot): Record<string, unknown> | null {
	return asRecordValue(parsed[root])
}

function containsPlaceholder(value: string | null): boolean {
	return Boolean(value && /REPLACE_WITH_YOUR_/iu.test(value))
}

function resolveConfigCwd(options: {
	cwd: string | null
	baseDir: string
	repoPathOverride: string | null
}): string | null {
	if (options.cwd && options.cwd.includes("${workspaceFolder}")) {
		return options.repoPathOverride ? path.resolve(options.repoPathOverride) : null
	}
	if (options.cwd) {
		return path.isAbsolute(options.cwd) ? path.resolve(options.cwd) : path.resolve(options.baseDir, options.cwd)
	}
	if (options.repoPathOverride) return path.resolve(options.repoPathOverride)
	return null
}

function buildHostSetupValidation(options: {
	host?: unknown
	configPath?: unknown
	configJson?: unknown
	repoPath?: unknown
	serverName?: unknown
}): BalloonHostSetupValidation {
	const host = parseHostKind(options.host)
	const surface = getHostSurface(host)
	const serverName = asString(options.serverName) ?? "balloon-mcp"
	const repoPathOverride = asString(options.repoPath) ? path.resolve(process.cwd(), asString(options.repoPath) as string) : null
	const errors: string[] = []
	const warnings: string[] = []
	const suggestedFixes: string[] = []
	let configSource = "inline config"
	let parsed: Record<string, unknown> | null = null
	let baseDir = process.cwd()
	const configPath = asString(options.configPath)
	const configJson = asString(options.configJson)
	if (configPath) {
		const resolvedConfigPath = path.resolve(process.cwd(), configPath)
		configSource = toPortablePath(resolvedConfigPath)
		baseDir = path.dirname(resolvedConfigPath)
		if (!fs.existsSync(resolvedConfigPath)) {
			errors.push(`Config file was not found: ${toPortablePath(resolvedConfigPath)}`)
		} else {
			try {
				parsed = asRecordValue(JSON.parse(fs.readFileSync(resolvedConfigPath, "utf8")))
			} catch (err) {
				errors.push(`Config file could not be parsed as JSON: ${err instanceof Error ? err.message : String(err)}`)
			}
		}
	} else if (configJson) {
		try {
			parsed = asRecordValue(JSON.parse(configJson))
		} catch (err) {
			errors.push(`configJson could not be parsed as JSON: ${err instanceof Error ? err.message : String(err)}`)
		}
	} else {
		errors.push("Provide either configPath or configJson.")
	}
	if (!parsed && errors.length === 0) errors.push("Config JSON must be an object.")

	const expectedConfigRoot = surface.configRoot
	const primaryRoot = parsed ? findConfigRootRecord(parsed, expectedConfigRoot) : null
	const alternateRootName: BalloonHostConfigRoot = expectedConfigRoot === "servers" ? "mcpServers" : "servers"
	const alternateRoot = parsed ? findConfigRootRecord(parsed, alternateRootName) : null
	let actualConfigRoot: BalloonHostConfigRoot | "unknown" = "unknown"
	let root = primaryRoot
	if (primaryRoot) actualConfigRoot = expectedConfigRoot
	else if (alternateRoot) {
		actualConfigRoot = alternateRootName
		root = alternateRoot
		warnings.push(`This host usually expects the ${expectedConfigRoot} root, but the config uses ${alternateRootName}.`)
	}
	if (!root && parsed) errors.push(`No ${expectedConfigRoot} or ${alternateRootName} root was found in the config.`)

	let serverEntry = root ? asRecordValue(root[serverName]) : null
	if (!serverEntry && root) {
		const entries = Object.entries(root).filter((entry) => asRecordValue(entry[1]) !== null)
		if (entries.length === 1) {
			serverEntry = asRecordValue(entries[0]?.[1])
			warnings.push(`Using the only server entry (${entries[0]?.[0] ?? "unknown"}) because ${serverName} was not present.`)
		}
	}
	const foundServerEntry = serverEntry !== null
	if (!foundServerEntry && root) errors.push(`No MCP server entry named ${serverName} was found.`)

	const command = asString(serverEntry?.command ?? null)
	const args = Array.isArray(serverEntry?.args) ? serverEntry.args.map((entry) => asString(entry)).filter((entry): entry is string => entry !== null) : []
	const cwd = asString(serverEntry?.cwd ?? null)
	if (host === "vscode") {
		const typeValue = asString(serverEntry?.type ?? null)
		if (typeValue !== "stdio") warnings.push("VS Code usually expects type: stdio for Balloon MCP.")
	}
	if (!command) errors.push("The server entry is missing command.")
	else if (!/(^|[\\/])node(?:\.exe)?$/iu.test(command) && command.toLowerCase() !== "node") warnings.push("The recommended command is node.")
	if (containsPlaceholder(command)) errors.push("The command still contains a placeholder value.")
	if (containsPlaceholder(cwd)) errors.push("The cwd still contains a placeholder value.")
	if (args.length === 0) errors.push("The server entry is missing args.")
	const startArg = args.find((arg) => /start\.(?:js|mjs|cjs)$/iu.test(arg) || arg.includes("start.js")) ?? null
	if (!startArg) errors.push("The args do not point to Balloon start.js.")
	if (containsPlaceholder(startArg)) errors.push("The start.js arg still contains a placeholder value.")
	if (!args.includes("--data-dir")) warnings.push("Adding --data-dir keeps Balloon state isolated per host or test flow.")
	const semanticAssistIndex = args.indexOf("--semantic-cara-mode")
	if (semanticAssistIndex !== -1 && args[semanticAssistIndex + 1] === "assist" && !args.includes("--semantic-cara-adapter")) {
		warnings.push("Assist mode is configured without --semantic-cara-adapter.")
	}
	if (process.platform === "win32" && cwd && !path.isAbsolute(cwd) && !cwd.includes("${workspaceFolder}") && host !== "vscode") {
		warnings.push("Absolute cwd paths are safer on Windows for this host.")
	}

	const resolvedCwd = resolveConfigCwd({
		cwd,
		baseDir,
		repoPathOverride,
	})
	let resolvedStartPath: string | null = null
	let buildReady: boolean | null = null
	if (startArg && (path.isAbsolute(startArg) || resolvedCwd)) {
		resolvedStartPath = path.isAbsolute(startArg) ? path.resolve(startArg) : path.resolve(resolvedCwd as string, startArg)
		buildReady = fs.existsSync(resolvedStartPath)
		if (!buildReady) warnings.push(`Resolved Balloon start.js was not found: ${toPortablePath(resolvedStartPath)}`)
	}
	if (!cwd && host !== "generic_json") warnings.push("Setting cwd makes start.js resolution more predictable for this host.")

	if (errors.some((error) => error.includes("command"))) suggestedFixes.push("Set command to node.")
	if (errors.some((error) => error.includes("start.js")) || warnings.some((warning) => warning.includes("start.js"))) {
		suggestedFixes.push("Regenerate the config with balloon_prepare_host_setup_packet or point args to the built start.js path.")
	}
	if (containsPlaceholder(cwd) || containsPlaceholder(startArg)) suggestedFixes.push("Replace placeholder paths with your real repo path before testing the host.")
	if (warnings.some((warning) => warning.includes("--data-dir"))) suggestedFixes.push("Add --data-dir .balloon-mcp-demo or another dedicated data folder.")
	if (warnings.some((warning) => warning.includes("Absolute cwd"))) suggestedFixes.push("Use an absolute cwd path for Windows host configs outside VS Code.")
	if (warnings.some((warning) => warning.includes("type: stdio"))) suggestedFixes.push("Add type: stdio for the VS Code servers entry.")
	return {
		host,
		displayName: surface.displayName,
		configSource,
		expectedConfigRoot,
		actualConfigRoot,
		foundServerEntry,
		valid: errors.length === 0,
		command,
		args,
		cwd,
		resolvedCwd: resolvedCwd ? toPortablePath(path.resolve(resolvedCwd)) : null,
		resolvedStartPath: resolvedStartPath ? toPortablePath(path.resolve(resolvedStartPath)) : null,
		buildReady,
		errors,
		warnings,
		suggestedFixes,
	}
}

const INSTALL_FALLBACK_TOOL_NAMES = ["balloon_prepare_host_setup_packet", "balloon_validate_host_setup"] as const
const BENCHMARK_SURFACE_TOOL_NAMES = [
	"balloon_compare_benchmark_lanes",
	"balloon_score_benchmark_lanes",
	"balloon_run_long_session_benchmark",
	"balloon_score_long_session_benchmark",
	"balloon_describe_slopcode_starter_suite",
	"balloon_plan_slopcode_starter_benchmark",
	"balloon_prepare_slopcode_live_run_packet",
	"balloon_prepare_slopcode_live_run_batch",
	"balloon_record_slopcode_run_evidence",
	"balloon_summarize_slopcode_run_evidence",
	"balloon_summarize_slopcode_starter_suite",
	"balloon_export_slopcode_starter_artifacts",
	"balloon_prepare_slopcode_problem",
] as const
const BENCHMARK_SURFACE_RESOURCE_URIS = [
	"balloon://benchmark/slopcode/starter-suite",
	"balloon://benchmark/slopcode/starter-suite/runbook",
	"balloon://benchmark/slopcode/live-run-playbook",
	"balloon://benchmark/slopcode/live-run-batch",
	"balloon://benchmark/slopcode/evidence",
] as const

function hasAllNamedTools(definitions: ToolDefinition[], names: readonly string[]): boolean {
	const knownNames = new Set(definitions.map((definition) => definition.name))
	return names.every((name) => knownNames.has(name))
}

function hasAllNamedPrompts(names: string[], requiredNames: string[]): boolean {
	const knownNames = new Set(names)
	return requiredNames.every((name) => knownNames.has(name))
}

function hasAllNamedResources(resources: ResourceDefinition[], uris: readonly string[]): boolean {
	const knownUris = new Set(resources.map((resource) => resource.uri))
	return uris.every((uri) => knownUris.has(uri))
}

function buildInstallDiagnostics(
	store: BalloonStateStore,
	options: {
		host?: unknown
		repoPath?: unknown
		configPath?: unknown
		configJson?: unknown
		serverName?: unknown
	},
): BalloonInstallDiagnostics {
	const requestedHost = asString(options.host) ? parseHostKind(options.host) : null
	const hostSurface = requestedHost ? getHostSurface(requestedHost) : null
	const repoPathInfo = resolveHostRepoPath(asString(options.repoPath))
	const repoPath = toPortablePath(path.resolve(repoPathInfo.repoPath))
	const startLayout = resolveHostStartLayout(repoPathInfo.repoPath)
	const definitions = buildBalloonToolDefinitions()
	const promptDefinitions = listBalloonPrompts()
	const promptNames = promptDefinitions.map((prompt) => prompt.name)
	const resources = listBalloonResources(store)
	const recommendedFirstTools = hostSurface ? [...hostSurface.recommendedFirstTools] : ["balloon_run_cycle", "balloon_repair_next_turn", "balloon_compare_benchmark_lanes"]
	const promptSensitiveSurfaces = hostSurface ? [...hostSurface.promptSensitiveSurfaces] : promptNames
	const promptFallbackReady =
		hasAllNamedTools(definitions, uniqueStrings([...recommendedFirstTools, ...INSTALL_FALLBACK_TOOL_NAMES])) &&
		hasAllNamedPrompts(promptNames, promptSensitiveSurfaces)
	const benchmarkSurfaceReady =
		hasAllNamedTools(definitions, BENCHMARK_SURFACE_TOOL_NAMES) && hasAllNamedResources(resources, BENCHMARK_SURFACE_RESOURCE_URIS)

	const configPath = asString(options.configPath)
	const configJson = asString(options.configJson)
	const serverName = asString(options.serverName)
	let configCheckMode: BalloonInstallDiagnostics["configCheckMode"] = "none"
	let hostConfigValidation: BalloonHostSetupValidation | null = null
	if (requestedHost) {
		if (configPath || configJson) {
			configCheckMode = "provided"
			hostConfigValidation = buildHostSetupValidation({
				host: requestedHost,
				configPath,
				configJson,
				repoPath: repoPathInfo.repoPath,
				serverName,
			})
		} else {
			configCheckMode = "generated"
			const generatedPacket = buildHostSetupPacket({
				host: requestedHost,
				repoPath: repoPathInfo.repoPath,
				serverName,
			})
			hostConfigValidation = buildHostSetupValidation({
				host: requestedHost,
				configJson: generatedPacket.configSnippet,
				repoPath: repoPathInfo.repoPath,
				serverName,
			})
		}
	}

	const warnings: string[] = []
	if (!startLayout.buildReady) warnings.push("Built Balloon start.js was not found yet. Run npm install and npm run build from the repo root.")
	if (hostSurface && configCheckMode === "generated") {
		warnings.push(`No ${hostSurface.displayName} config was provided, so diagnostics only validated a generated setup packet.`)
	}
	if (!requestedHost && (configPath || configJson)) {
		warnings.push("A config file or configJson was provided without host, so only repo-level diagnostics were run.")
	}
	if (!promptFallbackReady) warnings.push("Prompt fallback surfaces are incomplete. Rebuild or verify the Balloon MCP tool surface.")
	if (!benchmarkSurfaceReady) warnings.push("Benchmark surfaces are incomplete. Rebuild or verify the benchmark tool and resource surface.")
	if (hostSurface && hostSurface.readinessTier !== "recommended_first") {
		warnings.push(`${hostSurface.displayName} is still marked ${hostSurface.status}. VS Code remains the lowest-friction first host.`)
	}
	if (hostConfigValidation) {
		if (!hostConfigValidation.valid) warnings.push(`Host config validation failed for ${hostConfigValidation.displayName}.`)
		if (hostConfigValidation.buildReady === false) warnings.push("The resolved host start.js path does not exist yet.")
		for (const warning of hostConfigValidation.warnings) warnings.push(`Host config: ${warning}`)
	}

	const recommendedNextSteps: string[] = []
	if (!startLayout.buildReady) {
		recommendedNextSteps.push("Run npm install and npm run build from the repo root before attaching Balloon to a host.")
	}
	if (!requestedHost) {
		recommendedNextSteps.push("Choose a host and run balloon_prepare_host_setup_packet for a host-specific MCP config snippet.")
	} else if (configCheckMode === "generated") {
		recommendedNextSteps.push(`Paste the generated config into ${hostSurface?.displayName ?? requestedHost}, restart the MCP entry, then rerun balloon_run_install_diagnostics with configPath or configJson.`)
	}
	if (hostConfigValidation && hostConfigValidation.suggestedFixes.length > 0) {
		recommendedNextSteps.push(...hostConfigValidation.suggestedFixes)
	}
	if (requestedHost) {
		recommendedNextSteps.push(`Start with ${recommendedFirstTools.join(", ")} before trying ${promptSensitiveSurfaces.join(", ")}.`)
	}
	if (benchmarkSurfaceReady) {
		recommendedNextSteps.push("Run balloon_compare_benchmark_lanes or balloon_run_long_session_benchmark once the install looks healthy.")
	} else {
		recommendedNextSteps.push("Run npm run verify:balloon:mcp to confirm the benchmark surface is built and registered.")
	}

	const hostReady =
		hostConfigValidation === null ? true : configCheckMode === "provided" && hostConfigValidation.valid && hostConfigValidation.buildReady === true
	const overallReady = startLayout.buildReady && promptFallbackReady && benchmarkSurfaceReady && hostReady

	return {
		host: requestedHost,
		hostDisplayName: hostSurface?.displayName ?? null,
		configCheckMode,
		repoPath,
		buildReady: startLayout.buildReady,
		resolvedStartPath: startLayout.resolvedStartPath ? toPortablePath(path.resolve(startLayout.resolvedStartPath)) : null,
		toolCount: definitions.length,
		promptCount: promptDefinitions.length,
		resourceCount: resources.length,
		recommendedFirstTools,
		promptSensitiveSurfaces,
		promptFallbackReady,
		benchmarkSurfaceReady,
		hostConfigValidation,
		overallReady,
		warnings: uniqueStrings(warnings),
		recommendedNextSteps: uniqueStrings(recommendedNextSteps),
	}
}

function parseHostFlowKind(value: unknown, fallback: BalloonHostFlowKind = "repair_next_turn"): BalloonHostFlowKind {
	if (typeof value !== "string") return fallback
	switch (value.trim().toLowerCase()) {
		case "run_cycle":
			return "run_cycle"
		case "review":
		case "review_session_drift":
			return "review_session_drift"
		case "compare":
		case "compare_benchmark_lanes":
			return "compare_benchmark_lanes"
		case "install":
		case "install_diagnostics":
			return "install_diagnostics"
		case "repair":
		case "repair_next_turn":
		default:
			return fallback
	}
}

const HOST_VALIDATION_CASE_IDS: BalloonHostValidationCaseId[] = [
	"install_doctor",
	"same_chat_tool_repair",
	"fresh_chat_prompt_repair",
	"fresh_chat_prompt_review",
	"same_chat_benchmark_compare",
]

function parseHostValidationCaseId(value: unknown): BalloonHostValidationCaseId | null {
	if (typeof value !== "string") return null
	return HOST_VALIDATION_CASE_IDS.find((caseId) => caseId === value.trim()) ?? null
}

function parseHostValidationStatus(value: unknown): BalloonHostValidationResultStatus | null {
	if (typeof value !== "string") return null
	switch (value.trim().toLowerCase()) {
		case "pass":
			return "pass"
		case "partial":
			return "partial"
		case "fail":
			return "fail"
		default:
			return null
	}
}

function isPlaceholderText(value: string | null | undefined): boolean {
	return typeof value === "string" && /REPLACE_WITH_/u.test(value)
}

function buildHostPromptPacket(
	store: BalloonStateStore,
	name: string,
	args: Record<string, unknown>,
): BalloonHostPromptPacket | null {
	const prompt = getBalloonPrompt(store, name, args)
	if (!prompt) return null
	return {
		name,
		description: prompt.description,
		messages: prompt.messages.map((message) => ({
			role: message.role,
			text: message.content.text,
		})),
	}
}

function buildHostFlowPacket(
	store: BalloonStateStore,
	options: {
		host?: unknown
		flow?: unknown
		sessionId?: unknown
		userRequest?: unknown
		turns?: unknown
		repoPath?: unknown
		configPath?: unknown
		configJson?: unknown
		serverName?: unknown
		hydratePromptPacket?: boolean
	},
): BalloonHostFlowPacket {
	const host = parseHostKind(options.host)
	const flow = parseHostFlowKind(options.flow)
	const surface = getHostSurface(host)
	const sessionId = asString(options.sessionId) ?? "REPLACE_WITH_YOUR_SESSION_ID"
	const userRequest = asString(options.userRequest) ?? "REPLACE_WITH_YOUR_USER_REQUEST"
	const repoPath = asString(options.repoPath) ?? "REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH"
	const configPath = asString(options.configPath) ?? "REPLACE_WITH_YOUR_HOST_CONFIG_PATH"
	const configJson = asString(options.configJson) ?? undefined
	const serverName = asString(options.serverName) ?? "balloon-mcp"
	const incomingTurns = asTurns(options.turns)
	const turns =
		incomingTurns.length > 0
			? incomingTurns
			: [
					{ role: "system", content: "REPLACE_WITH_PROTECTED_CONTEXT" },
					{ role: "user", content: userRequest },
					{ role: "assistant", content: "REPLACE_WITH_DRIFTED_ASSISTANT_REPLY" },
				]

	let title = ""
	let summary = ""
	let preferredSurface: BalloonHostFlowPacket["preferredSurface"] = "tool"
	let alternateSurface: BalloonHostFlowPacket["alternateSurface"] = "none"
	let recommendedChatState: BalloonHostFlowPacket["recommendedChatState"] = "same_chat_ok"
	let exampleRequestPath: string | null = null
	let toolName: string | null = null
	let toolArgs: Record<string, unknown> | null = null
	let promptName: string | null = null
	let promptArgs: Record<string, unknown> | null = null
	const instructions: string[] = []
	const ifHostFeelsFlaky: string[] = []
	const warnings: string[] = []

	switch (flow) {
		case "run_cycle":
			title = "Run Balloon Cycle"
			summary = "First-pass host flow for building Balloon state, auditing drift, and proving the anti-drift loop is alive."
			exampleRequestPath = "examples/demo_run_cycle_request.json"
			toolName = "balloon_run_cycle"
			toolArgs = { sessionId, turns }
			instructions.push(
				`Start with ${toolName} in ${surface.displayName} before testing prompt-heavy flows.`,
				"Use a short three-turn scenario so the gap report and trickle are easy to inspect.",
				"Once the cycle looks healthy, move to repair or benchmark comparisons.",
			)
			ifHostFeelsFlaky.push(
				"Use the smallest possible demo session first so tool invocation problems are easy to isolate.",
				"Run balloon_prepare_host_setup_packet, balloon_validate_host_setup, and balloon_run_install_diagnostics before blaming Balloon logic.",
			)
			break
		case "repair_next_turn":
			title = "Repair Next Turn"
			summary = "Reliable repair path for the next reply, with an alternate prompt packet when the host's prompt routing behaves."
			alternateSurface = "prompt"
			recommendedChatState = "fresh_chat_preferred"
			exampleRequestPath = "examples/demo_repair_fallback_request.json"
			toolName = "balloon_repair_next_turn"
			toolArgs = { sessionId, userRequest }
			promptName = "balloon/repair-next-turn"
			promptArgs = { sessionId, userRequest }
			instructions.push(
				`Use ${toolName} first. It is the benchmark-safe repair path in ${surface.displayName}.`,
				`If the tool result looks right, try ${promptName} only as the alternate host-native surface.`,
				"Prefer a fresh chat when you test the prompt surface so stale host state does not confuse the result.",
			)
			ifHostFeelsFlaky.push(
				`Stay on ${toolName} for demos, benchmarks, and same-chat recovery.`,
				"Restart the MCP entry and open a fresh chat before retrying the prompt surface.",
				"Use balloon_run_install_diagnostics if the host seems healthy but prompts still feel inconsistent.",
			)
			break
		case "review_session_drift":
			title = "Review Session Drift"
			summary = "Reliable review path for inspecting why a session drifted, with an alternate prompt packet when the host supports prompt routing well."
			alternateSurface = "prompt"
			recommendedChatState = "fresh_chat_preferred"
			exampleRequestPath = "examples/demo_review_session_drift_request.json"
			toolName = "balloon_review_session_drift"
			toolArgs = { sessionId }
			promptName = "balloon/review-session-drift"
			promptArgs = { sessionId }
			instructions.push(
				`Use ${toolName} first so the drift review does not depend on prompt routing luck.`,
				"Read the review output before changing anything else in the session.",
				`If you want the host-native prompt surface later, try ${promptName} from a fresh chat.`,
			)
			ifHostFeelsFlaky.push(
				`Keep ${toolName} as the repeatable path for diagnosis.`,
				"Do not assume prompt failure means Balloon logic failed; restart and retry from a fresh chat first.",
				"Use the host playbook and install diagnostics before widening the investigation.",
			)
			break
		case "compare_benchmark_lanes":
			title = "Compare Benchmark Lanes"
			summary = "Stable four-lane comparison flow for baseline, deterministic, assist, and staged Balloon without depending on prompt routing."
			exampleRequestPath = "examples/demo_compare_benchmark_lanes_request.json"
			toolName = "balloon_compare_benchmark_lanes"
			toolArgs = { sessionId }
			instructions.push(
				`Use ${toolName} after the core repair flow is already working in ${surface.displayName}.`,
				"Keep the same session state when comparing lanes so the benchmark packet stays interpretable.",
				"Use this tool rather than ad-hoc prompt experiments when you want repeatable evaluation.",
			)
			ifHostFeelsFlaky.push(
				"Return to balloon_run_cycle and balloon_repair_next_turn first if this comparison feels off.",
				"Use a fresh chat if the host appears to cache old tool surfaces or stale arguments.",
			)
			break
		case "install_diagnostics":
			title = "Run Install Diagnostics"
			summary = "Strict install-doctor pass for checking repo build health, host config resolution, and whether the current host path is ready for strangers."
			alternateSurface = "resource"
			exampleRequestPath = "examples/install_diagnostics_request.example.json"
			toolName = "balloon_run_install_diagnostics"
			toolArgs = configJson ? { host, repoPath, configJson, serverName } : { host, repoPath, configPath, serverName }
			instructions.push(
				`Use ${toolName} before your first real host run and again after editing host config files.`,
				"Feed it a real configPath when possible so Balloon can resolve start.js and cwd the same way the host does.",
				`Read balloon://hosts/${host}/playbook after diagnostics if you want the safest next flow for this host.`,
			)
			ifHostFeelsFlaky.push(
				"Regenerate the config with balloon_prepare_host_setup_packet, then validate it again.",
				"Use balloon_validate_host_setup for focused config debugging and balloon://hosts/matrix for current host tiers.",
			)
			break
	}

	if (promptName && surface.promptSensitiveSurfaces.includes(promptName)) {
		warnings.push(`${promptName} is still more host-sensitive than the tool path in ${surface.displayName}.`)
	}
	if (host !== "vscode" && (flow === "repair_next_turn" || flow === "review_session_drift")) {
		warnings.push("Prompt routing outside VS Code still needs more repeated real-host validation.")
	}
	const hydratePromptPacket = typeof options.hydratePromptPacket === "boolean" ? options.hydratePromptPacket : true
	const promptPacket =
		hydratePromptPacket && promptName && promptArgs && !isPlaceholderText(sessionId) ? buildHostPromptPacket(store, promptName, promptArgs) : null
	if (promptName && !promptPacket && !isPlaceholderText(sessionId)) {
		warnings.push(`Prompt packet could not be materialized for ${promptName}. Confirm the session exists and Balloon has enough state.`)
	}
	if (promptName && isPlaceholderText(sessionId)) {
		warnings.push("Provide a real sessionId to materialize the prompt packet messages instead of the placeholder shape.")
	}

	return {
		host,
		displayName: surface.displayName,
		readinessTier: surface.readinessTier,
		status: surface.status,
		flow,
		title,
		summary,
		preferredSurface,
		alternateSurface,
		recommendedChatState,
		docsPath: surface.docsPath,
		exampleRequestPath,
		toolName,
		toolArgs,
		promptName,
		promptArgs,
		promptPacket,
		instructions,
		ifHostFeelsFlaky,
		restartHints: [...surface.restartHints],
		warnings,
	}
}

function buildHostPlaybook(store: BalloonStateStore, host: BalloonHostKind): BalloonHostFlowPacket[] {
	const flows: BalloonHostFlowKind[] = ["install_diagnostics", "run_cycle", "repair_next_turn", "review_session_drift", "compare_benchmark_lanes"]
	return flows.map((flow) =>
		buildHostFlowPacket(store, {
			host,
			flow,
			hydratePromptPacket: false,
		}),
	)
}

function buildHostValidationSuite(
	store: BalloonStateStore,
	options: {
		host?: unknown
		sessionId?: unknown
		userRequest?: unknown
		turns?: unknown
		repoPath?: unknown
		configPath?: unknown
		configJson?: unknown
		serverName?: unknown
	},
): BalloonHostValidationSuite {
	const host = parseHostKind(options.host)
	const surface = getHostSurface(host)
	const sharedOptions = {
		host,
		sessionId: options.sessionId,
		userRequest: options.userRequest,
		turns: options.turns,
		repoPath: options.repoPath,
		configPath: options.configPath,
		configJson: options.configJson,
		serverName: options.serverName,
	}
	const installPacket = buildHostFlowPacket(store, { ...sharedOptions, flow: "install_diagnostics" })
	const runCyclePacket = buildHostFlowPacket(store, { ...sharedOptions, flow: "run_cycle" })
	const repairPacket = buildHostFlowPacket(store, { ...sharedOptions, flow: "repair_next_turn" })
	const reviewPacket = buildHostFlowPacket(store, { ...sharedOptions, flow: "review_session_drift" })
	const benchmarkPacket = buildHostFlowPacket(store, { ...sharedOptions, flow: "compare_benchmark_lanes" })

	const cases: BalloonHostValidationCase[] = [
		{
			caseId: "install_doctor",
			title: "Install Doctor",
			goal: "Confirm the repo build and host config resolve cleanly before testing behavior in chat.",
			chatStateUnderTest: "same_chat_ok",
			primarySurfaceUnderTest: "tool",
			prerequisitePackets: [],
			primaryPacket: installPacket,
			steps: [
				"Run the install diagnostics packet first.",
				"Fix config, cwd, and start.js issues before testing prompt behavior.",
				"Read the host playbook only after the doctor pass is green or nearly green.",
			],
			successSignals: [
				"Build ready is yes.",
				"Host config validation is valid when a real config is provided.",
				"Recommended next steps are short cleanup items, not missing-core-surface failures.",
			],
			failureSignals: [
				"Resolved start.js is missing.",
				"Config root or server entry is wrong for the host.",
				"Tool, prompt, or resource counts suggest the MCP surface is incomplete.",
			],
		},
		{
			caseId: "same_chat_tool_repair",
			title: "Same-Chat Tool Repair",
			goal: "Confirm the tool-first repair path works in the same chat after Balloon state is built.",
			chatStateUnderTest: "same_chat_ok",
			primarySurfaceUnderTest: "tool",
			prerequisitePackets: [runCyclePacket],
			primaryPacket: repairPacket,
			steps: [
				"Run the Balloon cycle packet in one chat to seed the session state.",
				"Without restarting the host, run the repair packet in that same chat.",
				"Check whether the repaired reply preserves the earlier direction and verification obligations.",
			],
			successSignals: [
				"The repair tool returns a repaired reply and correction summary.",
				"The repaired reply keeps the bounded task instead of amplifying drift.",
				"No host restart or fresh chat is needed just to use the tool path.",
			],
			failureSignals: [
				"The tool is missing or stale in the same chat.",
				"The reply ignores earlier constraints even though the session was already seeded.",
				"The host appears to keep old arguments or stale MCP tool state.",
			],
		},
		{
			caseId: "fresh_chat_prompt_repair",
			title: "Fresh-Chat Prompt Repair",
			goal: "Check whether the host can invoke the repair prompt cleanly from a fresh chat once the session already exists.",
			chatStateUnderTest: "fresh_chat_preferred",
			primarySurfaceUnderTest: "prompt",
			prerequisitePackets: [runCyclePacket, repairPacket],
			primaryPacket: repairPacket,
			steps: [
				"Seed the session with the same-chat tool path first.",
				"Open a fresh chat and try the prompt route instead of the tool route.",
				"Compare the host-native prompt result against the tool repair result for the same session.",
			],
			successSignals: [
				"The host can find balloon/repair-next-turn with the expected args.",
				"The prompt result preserves the same core constraints as the tool repair path.",
				"The host does not require extra undocumented nudges to route the prompt correctly.",
			],
			failureSignals: [
				"The prompt is missing, ignored, or routed with stale args.",
				"The prompt result drifts materially from the tool repair result for the same session.",
				"The host only behaves after extra verbal steering not captured in docs or playbooks.",
			],
		},
		{
			caseId: "fresh_chat_prompt_review",
			title: "Fresh-Chat Prompt Review",
			goal: "Check whether the review prompt behaves consistently enough to diagnose drift from a fresh chat.",
			chatStateUnderTest: "fresh_chat_preferred",
			primarySurfaceUnderTest: "prompt",
			prerequisitePackets: [runCyclePacket, reviewPacket],
			primaryPacket: reviewPacket,
			steps: [
				"Seed the session first so Balloon has real gaps and trickles to inspect.",
				"Open a fresh chat and try the review prompt path.",
				"Compare the host-native prompt result with the tool fallback review packet.",
			],
			successSignals: [
				"The prompt result returns a concrete drift diagnosis.",
				"The diagnosis still points to the smallest safe next step.",
				"The prompt path feels equivalent to the tool fallback, not weaker or randomly different.",
			],
			failureSignals: [
				"The prompt route fails or returns generic advice without using the seeded session.",
				"The host loses the sectioned drift diagnosis shape.",
				"The prompt path is materially less reliable than the tool fallback in a fresh chat.",
			],
		},
		{
			caseId: "same_chat_benchmark_compare",
			title: "Same-Chat Benchmark Compare",
			goal: "Confirm the four-lane comparison surface stays stable after the host has already used other Balloon tools in the same chat.",
			chatStateUnderTest: "same_chat_ok",
			primarySurfaceUnderTest: "tool",
			prerequisitePackets: [runCyclePacket, repairPacket],
			primaryPacket: benchmarkPacket,
			steps: [
				"Keep the same chat open after the repair path succeeds.",
				"Run the four-lane comparison packet without resetting the host.",
				"Check whether all lanes return and whether the packet still feels benchmark-safe.",
			],
			successSignals: [
				"Baseline, deterministic, assist, and staged lanes are all present.",
				"The host does not lose tool visibility after earlier Balloon calls.",
				"The comparison packet remains legible and repeatable in the same chat.",
			],
			failureSignals: [
				"The host drops tools or returns stale tool surfaces mid-session.",
				"Later Balloon calls require a restart even though the setup was healthy.",
				"The benchmark comparison packet is incomplete or obviously stale.",
			],
		},
	]

	const warnings: string[] = []
	if (host !== "vscode") warnings.push(`${surface.displayName} still needs more repeated real-host validation than the VS Code-first path.`)
	if (cases.some((validationCase) => validationCase.primaryPacket.promptPacket === null && validationCase.primaryPacket.promptName !== null)) {
		warnings.push("Some prompt packets are still placeholder-only. Provide a real sessionId to materialize prompt messages.")
	}
	if (surface.readinessTier !== "recommended_first") warnings.push("Treat prompt-path validation as secondary to the tool-first validation cases for this host.")

	return {
		host,
		displayName: surface.displayName,
		readinessTier: surface.readinessTier,
		status: surface.status,
		docsPath: surface.docsPath,
		validationDocPath: "docs/HOST_VALIDATION.md",
		summary: "Built-in validation suite for install, same-chat tool flows, and fresh-chat prompt checks across the current Balloon host surface.",
		recommendedOrder: cases.map((validationCase) => validationCase.caseId),
		cases,
		warnings: uniqueStrings(warnings),
	}
}

function buildHostValidationEvidenceSummary(store: BalloonStateStore, host: BalloonHostKind): BalloonHostValidationEvidenceSummary {
	const surface = getHostSurface(host)
	const suite = buildHostValidationSuite(store, { host })
	const recentRuns = store.listHostValidationEvidence(host, 25)
	const rollups: BalloonHostValidationCaseEvidenceRollup[] = suite.cases.map((validationCase) => {
		const caseRuns = recentRuns.filter((run) => run.caseId === validationCase.caseId)
		const latest = caseRuns[0] ?? null
		return {
			caseId: validationCase.caseId,
			title: validationCase.title,
			latestStatus: latest?.status ?? "not_run",
			latestSummary: latest?.summary ?? null,
			totalRuns: caseRuns.length,
			passCount: caseRuns.filter((run) => run.status === "pass").length,
			partialCount: caseRuns.filter((run) => run.status === "partial").length,
			failCount: caseRuns.filter((run) => run.status === "fail").length,
			lastRecordedAt: latest?.recordedAt ?? null,
		}
	})
	const totalRuns = recentRuns.length
	const passCount = recentRuns.filter((run) => run.status === "pass").length
	const partialCount = recentRuns.filter((run) => run.status === "partial").length
	const failCount = recentRuns.filter((run) => run.status === "fail").length
	const completedCases = rollups.filter((rollup) => rollup.latestStatus !== "not_run").length
	const openRisks: string[] = []
	for (const rollup of rollups) {
		if (rollup.latestStatus === "fail") openRisks.push(`${rollup.title} is currently failing in ${surface.displayName}.`)
		else if (rollup.latestStatus === "partial") openRisks.push(`${rollup.title} is only partially working in ${surface.displayName}.`)
		else if (rollup.latestStatus === "not_run") openRisks.push(`${rollup.title} has no recorded validation evidence yet.`)
	}
	if (surface.readinessTier !== "recommended_first") {
		openRisks.push(`${surface.displayName} still sits below the VS Code-first path in readiness tier.`)
	}
	return {
		host,
		displayName: surface.displayName,
		readinessTier: surface.readinessTier,
		status: surface.status,
		totalRuns,
		passCount,
		partialCount,
		failCount,
		latestRecordedAt: recentRuns[0]?.recordedAt ?? null,
		coverage: {
			completedCases,
			totalCases: rollups.length,
		},
		cases: rollups,
		recentRuns,
		openRisks: uniqueStrings(openRisks),
	}
}

function formatHostSurface(surface: BalloonHostSurface): string {
	return [
		`Host: ${surface.displayName}`,
		`Key: ${surface.host}`,
		`Tier: ${surface.readinessTier}`,
		`Status: ${surface.status}`,
		`Config root: ${surface.configRoot}`,
		`Example config: ${surface.exampleConfigPath}`,
		`Docs: ${surface.docsPath}`,
		`Recommended first tools: ${surface.recommendedFirstTools.join(", ")}`,
		`Prompt-sensitive surfaces: ${surface.promptSensitiveSurfaces.join(", ")}`,
		"Restart hints",
		...surface.restartHints.map((hint, index) => `${index + 1}. ${hint}`),
		"Known caveats",
		...surface.knownCaveats.map((caveat, index) => `${index + 1}. ${caveat}`),
		"Notes",
		...surface.notes.map((note, index) => `${index + 1}. ${note}`),
	].join("\n")
}

function formatHostSurfaceMatrix(surfaces: BalloonHostSurface[]): string {
	return [
		"Balloon host matrix",
		"",
		...surfaces.flatMap((surface, index) => [
			`${index + 1}. ${surface.displayName}`,
			`Key: ${surface.host}`,
			`Tier: ${surface.readinessTier}`,
			`Status: ${surface.status}`,
			`Config root: ${surface.configRoot}`,
			`Recommended first tools: ${surface.recommendedFirstTools.join(", ")}`,
			`Docs: ${surface.docsPath}`,
			"",
		]),
	].join("\n")
}

function formatHostSetupPacket(packet: BalloonHostSetupPacket): string {
	return [
		`Host: ${packet.displayName}`,
		`Status: ${packet.status}`,
		`Tier: ${packet.readinessTier}`,
		`Config root: ${packet.configRoot}`,
		`Repo path: ${packet.repoPath}`,
		`Command: ${packet.command}`,
		`Args: ${packet.args.join(" ")}`,
		`cwd: ${packet.cwd}`,
		`Data dir: ${packet.dataDir}`,
		`Resolved start.js: ${packet.resolvedStartPath ?? "not found yet"}`,
		`Build ready: ${packet.buildReady ? "yes" : "no"}`,
		`Example config: ${packet.exampleConfigPath}`,
		`Docs: ${packet.docsPath}`,
		"",
		"Recommended first tools",
		...packet.recommendedFirstTools.map((tool, index) => `${index + 1}. ${tool}`),
		"Prompt-sensitive surfaces",
		...packet.promptSensitiveSurfaces.map((surface, index) => `${index + 1}. ${surface}`),
		"Restart hints",
		...packet.restartHints.map((hint, index) => `${index + 1}. ${hint}`),
		...(packet.validationWarnings.length > 0 ? ["Validation warnings", ...packet.validationWarnings.map((warning, index) => `${index + 1}. ${warning}`)] : ["Validation warnings", "None."]),
		"First-run checklist",
		...packet.firstRunChecklist.map((item, index) => `${index + 1}. ${item}`),
		"",
		"Config snippet",
		"```json",
		packet.configSnippet,
		"```",
	].join("\n")
}

function formatHostSetupValidation(result: BalloonHostSetupValidation): string {
	return [
		`Host: ${result.displayName}`,
		`Config source: ${result.configSource}`,
		`Expected config root: ${result.expectedConfigRoot}`,
		`Actual config root: ${result.actualConfigRoot}`,
		`Server entry found: ${result.foundServerEntry ? "yes" : "no"}`,
		`Valid: ${result.valid ? "yes" : "no"}`,
		`Command: ${result.command ?? "missing"}`,
		`Args: ${result.args.length > 0 ? result.args.join(" ") : "missing"}`,
		`cwd: ${result.cwd ?? "missing"}`,
		`Resolved cwd: ${result.resolvedCwd ?? "not resolved"}`,
		`Resolved start.js: ${result.resolvedStartPath ?? "not resolved"}`,
		`Build ready: ${result.buildReady === null ? "unknown" : result.buildReady ? "yes" : "no"}`,
		...(result.errors.length > 0 ? ["Errors", ...result.errors.map((error, index) => `${index + 1}. ${error}`)] : ["Errors", "None."]),
		...(result.warnings.length > 0 ? ["Warnings", ...result.warnings.map((warning, index) => `${index + 1}. ${warning}`)] : ["Warnings", "None."]),
		...(result.suggestedFixes.length > 0 ? ["Suggested fixes", ...result.suggestedFixes.map((fix, index) => `${index + 1}. ${fix}`)] : []),
	].join("\n")
}

function formatInstallDiagnostics(result: BalloonInstallDiagnostics): string {
	const configCheckLabel =
		result.configCheckMode === "provided" ? "provided host config" : result.configCheckMode === "generated" ? "generated host packet" : "repo-only"
	return [
		"Balloon install diagnostics",
		`Host: ${result.hostDisplayName ?? "repo-only diagnostics"}`,
		`Config check mode: ${configCheckLabel}`,
		`Repo path: ${result.repoPath}`,
		`Resolved start.js: ${result.resolvedStartPath ?? "not found yet"}`,
		`Build ready: ${result.buildReady ? "yes" : "no"}`,
		`Tool count: ${result.toolCount}`,
		`Prompt count: ${result.promptCount}`,
		`Resource count: ${result.resourceCount}`,
		`Prompt fallback ready: ${result.promptFallbackReady ? "yes" : "no"}`,
		`Benchmark surface ready: ${result.benchmarkSurfaceReady ? "yes" : "no"}`,
		`Overall ready: ${result.overallReady ? "yes" : "no"}`,
		"Recommended first tools",
		...(result.recommendedFirstTools.length > 0 ? result.recommendedFirstTools.map((tool, index) => `${index + 1}. ${tool}`) : ["None."]),
		"Prompt-sensitive surfaces",
		...(result.promptSensitiveSurfaces.length > 0 ? result.promptSensitiveSurfaces.map((surface, index) => `${index + 1}. ${surface}`) : ["None."]),
		...(result.warnings.length > 0 ? ["Warnings", ...result.warnings.map((warning, index) => `${index + 1}. ${warning}`)] : ["Warnings", "None."]),
		...(result.recommendedNextSteps.length > 0
			? ["Recommended next steps", ...result.recommendedNextSteps.map((step, index) => `${index + 1}. ${step}`)]
			: ["Recommended next steps", "None."]),
		...(result.hostConfigValidation ? ["Host config validation", formatHostSetupValidation(result.hostConfigValidation)] : []),
	].join("\n")
}

function formatHostFlowPacket(packet: BalloonHostFlowPacket): string {
	return [
		`Host: ${packet.displayName}`,
		`Flow: ${packet.title}`,
		`Summary: ${packet.summary}`,
		`Tier: ${packet.readinessTier}`,
		`Status: ${packet.status}`,
		`Preferred surface: ${packet.preferredSurface}`,
		`Alternate surface: ${packet.alternateSurface}`,
		`Recommended chat state: ${packet.recommendedChatState === "fresh_chat_preferred" ? "fresh chat preferred" : "same chat ok"}`,
		`Docs: ${packet.docsPath}`,
		`Example request: ${packet.exampleRequestPath ?? "none"}`,
		`Tool: ${packet.toolName ?? "none"}`,
		...(packet.toolArgs ? ["Tool args", "```json", JSON.stringify(packet.toolArgs, null, 2), "```"] : []),
		`Prompt: ${packet.promptName ?? "none"}`,
		...(packet.promptArgs ? ["Prompt args", "```json", JSON.stringify(packet.promptArgs, null, 2), "```"] : []),
		...(packet.promptPacket
			? [
					"Prompt packet",
					`Description: ${packet.promptPacket.description}`,
					...packet.promptPacket.messages.flatMap((message, index) => [`${index + 1}. ${message.role}`, message.text]),
				]
			: []),
		"Instructions",
		...packet.instructions.map((instruction, index) => `${index + 1}. ${instruction}`),
		"If host feels flaky",
		...packet.ifHostFeelsFlaky.map((instruction, index) => `${index + 1}. ${instruction}`),
		"Restart hints",
		...packet.restartHints.map((hint, index) => `${index + 1}. ${hint}`),
		...(packet.warnings.length > 0 ? ["Warnings", ...packet.warnings.map((warning, index) => `${index + 1}. ${warning}`)] : ["Warnings", "None."]),
	].join("\n")
}

function formatHostValidationSuite(suite: BalloonHostValidationSuite): string {
	return [
		`Host: ${suite.displayName}`,
		`Tier: ${suite.readinessTier}`,
		`Status: ${suite.status}`,
		`Docs: ${suite.docsPath}`,
		`Validation doc: ${suite.validationDocPath}`,
		`Summary: ${suite.summary}`,
		"Recommended order",
		...suite.recommendedOrder.map((caseId, index) => `${index + 1}. ${caseId}`),
		...(suite.warnings.length > 0 ? ["Warnings", ...suite.warnings.map((warning, index) => `${index + 1}. ${warning}`)] : ["Warnings", "None."]),
		...suite.cases.flatMap((validationCase, index) => [
			"",
			`${index + 1}. ${validationCase.title}`,
			`Case id: ${validationCase.caseId}`,
			`Goal: ${validationCase.goal}`,
			`Chat state under test: ${validationCase.chatStateUnderTest === "fresh_chat_preferred" ? "fresh chat preferred" : "same chat ok"}`,
			`Primary surface: ${validationCase.primarySurfaceUnderTest}`,
			`Primary flow: ${validationCase.primaryPacket.flow}`,
			...(validationCase.prerequisitePackets.length > 0
				? [`Prerequisite flows: ${validationCase.prerequisitePackets.map((packet) => packet.flow).join(", ")}`]
				: ["Prerequisite flows: none"]),
			"Steps",
			...validationCase.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`),
			"Success signals",
			...validationCase.successSignals.map((signal, signalIndex) => `${signalIndex + 1}. ${signal}`),
			"Failure signals",
			...validationCase.failureSignals.map((signal, signalIndex) => `${signalIndex + 1}. ${signal}`),
		]),
	].join("\n")
}

function formatHostValidationEvidence(evidence: BalloonHostValidationEvidence): string {
	return [
		`Host: ${evidence.host}`,
		`Case id: ${evidence.caseId}`,
		`Status: ${evidence.status}`,
		`Chat state under test: ${evidence.chatStateUnderTest === "fresh_chat_preferred" ? "fresh chat preferred" : "same chat ok"}`,
		`Session: ${evidence.sessionId ?? "none"}`,
		`Host version: ${evidence.hostVersion ?? "unknown"}`,
		`Recorded at: ${evidence.recordedAt}`,
		`Summary: ${evidence.summary}`,
		...(evidence.findings.length > 0 ? ["Findings", ...evidence.findings.map((finding, index) => `${index + 1}. ${finding}`)] : ["Findings", "None."]),
		...(evidence.suggestedFixes.length > 0
			? ["Suggested fixes", ...evidence.suggestedFixes.map((fix, index) => `${index + 1}. ${fix}`)]
			: ["Suggested fixes", "None."]),
	].join("\n")
}

function formatHostValidationEvidenceSummary(summary: BalloonHostValidationEvidenceSummary): string {
	return [
		`Host: ${summary.displayName}`,
		`Tier: ${summary.readinessTier}`,
		`Status: ${summary.status}`,
		`Total recorded runs: ${summary.totalRuns}`,
		`Coverage: ${summary.coverage.completedCases}/${summary.coverage.totalCases} validation cases`,
		`Passes: ${summary.passCount}`,
		`Partials: ${summary.partialCount}`,
		`Fails: ${summary.failCount}`,
		`Latest recorded at: ${summary.latestRecordedAt ?? "none"}`,
		"Case rollups",
		...summary.cases.flatMap((rollup, index) => [
			`${index + 1}. ${rollup.title}`,
			`Case id: ${rollup.caseId}`,
			`Latest status: ${rollup.latestStatus}`,
			`Latest summary: ${rollup.latestSummary ?? "none"}`,
			`Run counts: ${rollup.totalRuns} total | ${rollup.passCount} pass | ${rollup.partialCount} partial | ${rollup.failCount} fail`,
			`Last recorded at: ${rollup.lastRecordedAt ?? "none"}`,
		]),
		...(summary.openRisks.length > 0 ? ["Open risks", ...summary.openRisks.map((risk, index) => `${index + 1}. ${risk}`)] : ["Open risks", "None."]),
	].join("\n")
}

export function buildBalloonToolDefinitions(): ToolDefinition[] {
	return [
		{
			name: "balloon_run_cycle",
			title: "Run Balloon Cycle",
			description: "Runs the full Balloon v0.1 cycle: profile, hidden requirements, CARA audit, targeted retrieval, proxy trickle, and optional memory reinforcement.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					turns: {
						type: "array",
						description: "Optional turns to replace or append before running the cycle.",
						items: {
							type: "object",
							required: ["role", "content"],
							properties: {
								role: { type: "string", enum: ["user", "assistant", "system"] },
								content: { type: "string" },
								timestamp: { type: "string" },
							},
						},
					},
					mergeMode: { type: "string", enum: ["replace", "append"], description: "Whether provided turns replace or append." },
					latestUserRequest: { type: "string", description: "Optional explicit latest user request." },
					latestResponse: { type: "string", description: "Optional explicit latest assistant response." },
					retrievalLimit: { type: "number", description: "How many anchors to retrieve." },
					autoReinforceMemory: { type: "boolean", description: "Whether to update the memory ledger from the generated trickle." },
					reason: { type: "string", description: "Optional reason recorded when memory reinforcement is enabled." },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const incomingTurns = asTurns(args.turns)
				if (incomingTurns.length > 0) {
					const mergeMode = asString(args.mergeMode) === "append" ? "append" : "replace"
					if (mergeMode === "replace") context.store.replaceTurns(sessionId, incomingTurns)
					else context.store.appendTurns(sessionId, incomingTurns)
				}

				const storedTurns = context.store.getTurns(sessionId)
				if (storedTurns.length === 0) return toolError(`No turns found for session ${sessionId}. Provide turns or build a profile first.`)

				const profile = buildStructuredProfile(sessionId, storedTurns)
				context.store.saveProfile(profile)

				const latestUserRequest = asString(args.latestUserRequest) ?? findLatestTurnContent(storedTurns, "user")
				const latestResponse = asString(args.latestResponse) ?? findLatestTurnContent(storedTurns, "assistant")
				if (!latestUserRequest) return toolError("A latest user request is required. Provide latestUserRequest or include a user turn.")
				if (!latestResponse) return toolError("A latest assistant response is required. Provide latestResponse or include an assistant turn.")

				const hiddenRequirements = detectHiddenRequirements(latestUserRequest, latestResponse).filter((requirement) => !requirement.coveredByResponse)
				const gaps = auditLatestTurn(sessionId, profile, latestResponse, latestUserRequest)
				context.store.saveGaps(sessionId, gaps)
				const driftPressure = buildDriftPressure(sessionId, profile, latestResponse, latestUserRequest, gaps, hiddenRequirements)
				const persistentBias = buildPersistentDriftBias({
					sessionId,
					profile,
					gaps,
					recentGaps: context.store.getRecentGaps(sessionId, 12),
					hiddenRequirements,
					driftPressure,
					pressureHistory: buildDriftPressureHistorySummary(context.store, sessionId),
				})

				const retrievalLimit = asPositiveInt(args.retrievalLimit, 4)
				const retrievalQueries = [
					...gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]),
					...hiddenRequirements.map((requirement) => requirement.requirement),
					...persistentBias.queryBoosts,
				]
				const hits = retrieveRelevantTurns(storedTurns, retrievalQueries, retrievalLimit, { bias: persistentBias })
				const trickle = buildProxyTrickle(sessionId, gaps, hits, persistentBias)
				context.store.saveTrickle(trickle)

				const autoReinforceMemory = typeof args.autoReinforceMemory === "boolean" ? args.autoReinforceMemory : true
				const reason = asString(args.reason) ?? "balloon_run_cycle auto reinforcement"
				const memoryUpdates = autoReinforceMemory ? context.store.reinforceMemory(sessionId, trickle.priorityInstructions, reason) : []
				const nextTurnStance = buildNextTurnStance(profile, hiddenRequirements, driftPressure, trickle, persistentBias)
				const pressureSnapshot = persistDriftPressureSnapshot(context.store, {
					sessionId,
					source: "run_cycle",
					turnCount: storedTurns.length,
					requestText: latestUserRequest,
					latestResponse,
					pressure: driftPressure,
				})
				const pressureHistory = buildDriftPressureHistorySummary(context.store, sessionId)

				const textSections = [
					"Balloon cycle complete.",
					"",
					"Profile",
					formatProfile(profile),
					"",
					"Missing hidden requirements",
					formatHiddenRequirements(hiddenRequirements),
					"",
					"Gap report",
					formatGaps(gaps),
					"",
					"Drift pressure",
					formatDriftPressure(driftPressure),
					"",
					"Persistent drift focus",
					formatPersistentBias(persistentBias),
					"",
					"Pressure history",
					formatDriftPressureHistory(pressureHistory),
					"",
					"Retrieval anchors",
					formatRetrievalHits(hits),
					"",
					"Proxy trickle",
					formatTrickle(trickle),
					"",
					"Suggested next-turn stance",
					formatList(nextTurnStance, "No additional next-turn guidance generated."),
				]
				if (autoReinforceMemory) {
					textSections.push("", "Memory updates", memoryUpdates.length > 0 ? summarizeMemoryPromotion(memoryUpdates).join("\n") : "No memory updates recorded.")
				}

				return textResult(textSections.join("\n"), {
					sessionId,
					profile,
					hiddenRequirements,
					gapCount: gaps.length,
					gaps,
					driftPressure,
					persistentBias,
					pressureSnapshot,
					pressureHistory,
					hits,
					trickle,
					nextTurnStance,
					memoryUpdates,
					autoReinforceMemory,
				})
			},
		},
		{
			name: "balloon_build_profile",
			title: "Build Balloon Profile",
			description: "Builds or updates a structured user/project profile from conversation turns.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId", "turns"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					turns: {
						type: "array",
						items: {
							type: "object",
							required: ["role", "content"],
							properties: {
								role: { type: "string", enum: ["user", "assistant", "system"] },
								content: { type: "string" },
								timestamp: { type: "string" },
							},
						},
					},
					mergeMode: { type: "string", enum: ["replace", "append"], description: "Whether to replace or append stored turns." },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const turns = asTurns(args.turns)
				if (turns.length === 0) return toolError("At least one valid turn is required.")
				const mergeMode = asString(args.mergeMode) === "append" ? "append" : "replace"
				if (mergeMode === "replace") context.store.replaceTurns(sessionId, turns)
				else context.store.appendTurns(sessionId, turns)
				const storedTurns = context.store.getTurns(sessionId)
				const profile = buildStructuredProfile(sessionId, storedTurns)
				context.store.saveProfile(profile)
				return textResult(`Balloon profile built.\n${formatProfile(profile)}`, { sessionId, profile })
			},
		},
		{
			name: "balloon_audit_turn",
			title: "Audit Latest Turn With CARA",
			description: "Runs a CARA-style audit on the latest response against stored Balloon profile context.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId", "latestResponse"],
				properties: {
					sessionId: { type: "string" },
					latestResponse: { type: "string" },
					latestUserRequest: { type: "string" },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				const latestResponse = asString(args.latestResponse)
				const latestUserRequest = asString(args.latestUserRequest) ?? undefined
				if (!sessionId || !latestResponse) return toolError("sessionId and latestResponse are required.")
				const profile = context.store.getProfile(sessionId)
				if (!profile) return toolError(`No profile found for session ${sessionId}. Run balloon_build_profile first.`)
				const gaps = auditLatestTurn(sessionId, profile, latestResponse, latestUserRequest)
				const hiddenRequirements = latestUserRequest ? detectHiddenRequirements(latestUserRequest, latestResponse).filter((requirement) => !requirement.coveredByResponse) : []
				const driftPressure = buildDriftPressure(sessionId, profile, latestResponse, latestUserRequest, gaps, hiddenRequirements)
				context.store.saveGaps(sessionId, gaps)
				const turnCount = context.store.getTurns(sessionId, 5000).length
				const pressureSnapshot = persistDriftPressureSnapshot(context.store, {
					sessionId,
					source: "audit_turn",
					turnCount,
					requestText: latestUserRequest,
					latestResponse,
					pressure: driftPressure,
				})
				const pressureHistory = buildDriftPressureHistorySummary(context.store, sessionId)
				return textResult([formatGaps(gaps), "", "Drift pressure", formatDriftPressure(driftPressure), "", "Pressure history", formatDriftPressureHistory(pressureHistory)].join("\n"), {
					sessionId,
					gapCount: gaps.length,
					gaps,
					driftPressure,
					pressureSnapshot,
					pressureHistory,
				})
			},
		},
		{
			name: "balloon_detect_hidden_requirements",
			title: "Detect Hidden Requirements",
			description: "Surfaces questions behind the question and plausible follow-on work the response may have missed.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId", "latestUserRequest"],
				properties: {
					sessionId: { type: "string" },
					latestUserRequest: { type: "string" },
					latestResponse: { type: "string" },
				},
			},
			run: (args) => {
				const sessionId = asString(args.sessionId)
				const latestUserRequest = asString(args.latestUserRequest)
				const latestResponse = asString(args.latestResponse) ?? undefined
				if (!sessionId || !latestUserRequest) return toolError("sessionId and latestUserRequest are required.")
				const requirements = detectHiddenRequirements(latestUserRequest, latestResponse)
				const missing = requirements.filter((requirement) => !requirement.coveredByResponse)
				return textResult(formatHiddenRequirements(missing), { sessionId, requirements: missing })
			},
		},
		{
			name: "balloon_targeted_retrieval",
			title: "Run Targeted Retrieval",
			description: "Retrieves only the turns most relevant to the active Balloon gaps or a supplied query.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string" },
					gapIds: { type: "array", items: { type: "string" } },
					query: { type: "string" },
					limit: { type: "number" },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const gapIds = Array.isArray(args.gapIds) ? args.gapIds.map((value) => asString(value)).filter((value): value is string => value !== null) : []
				const query = asString(args.query)
				const limit = asPositiveInt(args.limit, 5)
				const turns = context.store.getTurns(sessionId)
				if (turns.length === 0) return toolError(`No turns found for session ${sessionId}.`)
				const gaps = getActiveGaps(context.store, sessionId, gapIds)
				const derivedQueries = [...gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]), ...(query ? [query] : [])]
				const hits = retrieveRelevantTurns(turns, derivedQueries, limit)
				return textResult(formatRetrievalHits(hits), { sessionId, queries: derivedQueries, hits })
			},
		},
		{
			name: "balloon_generate_proxy_trickle",
			title: "Generate Proxy Trickle",
			description: "Builds a small non-overriding corrective payload for the next turn from active Balloon gaps and retrieval anchors.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string" },
					gapIds: { type: "array", items: { type: "string" } },
					limit: { type: "number" },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const gapIds = Array.isArray(args.gapIds) ? args.gapIds.map((value) => asString(value)).filter((value): value is string => value !== null) : []
				const limit = asPositiveInt(args.limit, 4)
				const turns = context.store.getTurns(sessionId)
				const gaps = getActiveGaps(context.store, sessionId, gapIds)
				if (gaps.length === 0) return toolError("No active gaps found for trickle generation.")
				const hits = retrieveRelevantTurns(turns, gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]), limit)
				const trickle = buildProxyTrickle(sessionId, gaps, hits)
				context.store.saveTrickle(trickle)
				return textResult(formatTrickle(trickle), { sessionId, trickle })
			},
		},
		{
			name: "balloon_repair_next_turn",
			title: "Repair Next Turn",
			description: "Tool-level fallback for the Balloon repair path. Builds the repair prompt packet and a deterministic repaired next-turn reply without relying on MCP prompt routing.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					userRequest: { type: "string", description: "Optional explicit user request to repair against." },
					latestResponse: { type: "string", description: "Optional explicit latest assistant response to audit before building the repair packet." },
					semanticMode: { type: "string", enum: ["off", "shadow", "assist"], description: "Optional semantic CARA mode override for this repair call." },
					semanticAdapterPath: { type: "string", description: "Optional path to a semantic CARA adapter executable or .js/.mjs file." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic CARA adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic CARA notes returned." },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const bundle = buildBalloonRepairBundle(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticMode: args.semanticMode,
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
				})
				if (!bundle) return toolError(`Could not build a repair packet for session ${sessionId}. A user request and prior Balloon session state are required.`)
				const pressureSnapshot = persistDriftPressureSnapshot(context.store, {
					sessionId,
					source: "repair_packet",
					turnCount: bundle.profile.sourceTurnCount,
					requestText: bundle.requestText,
					latestResponse: bundle.latestResponse,
					pressure: bundle.driftPressure,
				})
				const pressureHistory = buildDriftPressureHistorySummary(context.store, sessionId)
				const text = [
					"Balloon repair packet ready.",
					"",
					"Suggested repaired next assistant reply",
					bundle.repairedReply,
					"",
					"What Balloon corrected",
					bundle.correctionSummary,
					"",
					"Drift pressure",
					formatDriftPressure(bundle.driftPressure),
					"",
					"Persistent drift focus",
					formatPersistentBias(bundle.persistentBias),
					"",
					"Pressure history",
					formatDriftPressureHistory(pressureHistory),
					"",
					"Semantic CARA",
					formatSemanticCara(bundle.semanticCara),
					"",
					"Suggested next-turn stance",
					formatList(bundle.nextTurnStance, "No additional next-turn guidance generated."),
				].join("\n")
				return textResult(text, {
					sessionId,
					requestText: bundle.requestText,
					profile: bundle.profile,
					hiddenRequirements: bundle.hiddenRequirements,
					gaps: bundle.gaps,
					driftPressure: bundle.driftPressure,
					persistentBias: bundle.persistentBias,
					pressureSnapshot,
					pressureHistory,
					trickle: bundle.trickle,
					releasePacket: bundle.releasePacket,
					nextTurnStance: bundle.nextTurnStance,
					deterministicReply: bundle.deterministicReply,
					repairedReply: bundle.repairedReply,
					deterministicCorrectionSummary: bundle.deterministicCorrectionSummary,
					correctionSummary: bundle.correctionSummary,
					semanticCaraConfig: bundle.semanticCaraConfig,
					semanticCara: bundle.semanticCara,
					promptMessages: bundle.messages,
				})
			},
		},
		{
			name: "balloon_semantic_cara_preview",
			title: "Preview Semantic CARA",
			description: "Builds the repair packet, shows the deterministic baseline, and runs the optional semantic CARA lane in shadow or assist mode.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					userRequest: { type: "string", description: "Optional explicit user request to repair against." },
					latestResponse: { type: "string", description: "Optional explicit latest assistant response to audit before building the repair packet." },
					semanticMode: { type: "string", enum: ["off", "shadow", "assist"], description: "Semantic CARA mode for this preview run." },
					semanticAdapterPath: { type: "string", description: "Optional path to a semantic CARA adapter executable or .js/.mjs file." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic CARA adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic CARA notes returned." },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const bundle = buildBalloonRepairBundle(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticMode: args.semanticMode,
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
				})
				if (!bundle) return toolError(`Could not build a semantic preview packet for session ${sessionId}.`)
				const text = [
					"Balloon semantic CARA preview ready.",
					"",
					"Deterministic repaired reply",
					bundle.deterministicReply,
					"",
					"Effective repaired reply",
					bundle.repairedReply,
					"",
					"Drift pressure",
					formatDriftPressure(bundle.driftPressure),
					"",
					"Semantic CARA",
					formatSemanticCara(bundle.semanticCara),
				].join("\n")
				const pressureSnapshot = persistDriftPressureSnapshot(context.store, {
					sessionId,
					source: "repair_packet",
					turnCount: bundle.profile.sourceTurnCount,
					requestText: bundle.requestText,
					latestResponse: bundle.latestResponse,
					pressure: bundle.driftPressure,
				})
				const pressureHistory = buildDriftPressureHistorySummary(context.store, sessionId)
				return textResult(text, {
					sessionId,
					requestText: bundle.requestText,
					latestResponse: bundle.latestResponse,
					profile: bundle.profile,
					gaps: bundle.gaps,
					hiddenRequirements: bundle.hiddenRequirements,
					driftPressure: bundle.driftPressure,
					pressureSnapshot,
					pressureHistory,
					releasePacket: bundle.releasePacket,
					nextTurnStance: bundle.nextTurnStance,
					deterministicReply: bundle.deterministicReply,
					repairedReply: bundle.repairedReply,
					correctionSummary: bundle.correctionSummary,
					semanticCaraConfig: bundle.semanticCaraConfig,
					semanticCara: bundle.semanticCara,
					promptMessages: bundle.messages,
				})
			},
		},
		{
			name: "balloon_compare_repair_lanes",
			title: "Compare Repair Lanes",
			description: "Builds the deterministic repair reply and the hybrid semantic repair reply side by side for the same session.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					userRequest: { type: "string", description: "Optional explicit user request to repair against." },
					latestResponse: { type: "string", description: "Optional explicit latest assistant response to audit before building the repair packet." },
					semanticMode: { type: "string", enum: ["shadow", "assist"], description: "Hybrid lane mode for this comparison. Defaults to shadow." },
					semanticAdapterPath: { type: "string", description: "Optional path to a semantic CARA adapter executable or .js/.mjs file." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic CARA adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic CARA notes returned." },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const deterministic = buildBalloonRepairBundle(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticMode: "off",
				})
				if (!deterministic) return toolError(`Could not build a deterministic repair packet for session ${sessionId}.`)
				const hybrid = buildBalloonRepairBundle(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticMode: asString(args.semanticMode) ?? "shadow",
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
				})
				if (!hybrid) return toolError(`Could not build a hybrid repair packet for session ${sessionId}.`)
				const pressureSnapshot = persistDriftPressureSnapshot(context.store, {
					sessionId,
					source: "repair_packet",
					turnCount: hybrid.profile.sourceTurnCount,
					requestText: hybrid.requestText,
					latestResponse: hybrid.latestResponse,
					pressure: hybrid.driftPressure,
				})
				const pressureHistory = buildDriftPressureHistorySummary(context.store, sessionId)
				const replyChanged = deterministic.repairedReply.trim() !== hybrid.repairedReply.trim()
				const semanticSignalChanged =
					hybrid.semanticCara.notes.length > 0 ||
					hybrid.semanticCara.status !== "disabled" ||
					(hybrid.semanticCara.suggestedAdditions?.length ?? 0) > 0 ||
					Boolean(hybrid.semanticCara.error)
				const laneChanged = replyChanged || semanticSignalChanged
				const laneDeltaSummary = replyChanged
					? "Hybrid lane changed the repaired reply."
					: semanticSignalChanged
						? "Hybrid lane added semantic signal but did not change the repaired reply."
						: "Hybrid lane did not materially change the repaired output for this session."
				const text = [
					"Balloon repair lane comparison ready.",
					"",
					"Deterministic repaired reply",
					deterministic.repairedReply,
					"",
					"Hybrid repaired reply",
					hybrid.repairedReply,
					"",
					"Drift pressure",
					formatDriftPressure(hybrid.driftPressure),
					"",
					"Pressure history",
					formatDriftPressureHistory(pressureHistory),
					"",
					"Semantic CARA",
					formatSemanticCara(hybrid.semanticCara),
					"",
					"Lane delta",
					`Reply changed: ${replyChanged ? "yes" : "no"}`,
					`Semantic signal changed: ${semanticSignalChanged ? "yes" : "no"}`,
					laneDeltaSummary,
				].join("\n")
				return textResult(text, {
					sessionId,
					requestText: hybrid.requestText,
					latestResponse: hybrid.latestResponse,
					profile: hybrid.profile,
					gaps: hybrid.gaps,
					hiddenRequirements: hybrid.hiddenRequirements,
					driftPressure: hybrid.driftPressure,
					pressureSnapshot,
					pressureHistory,
					releasePacket: hybrid.releasePacket,
					nextTurnStance: hybrid.nextTurnStance,
					deterministicReply: deterministic.repairedReply,
					deterministicCorrectionSummary: deterministic.correctionSummary,
					hybridReply: hybrid.repairedReply,
					hybridCorrectionSummary: hybrid.correctionSummary,
					replyChanged,
					semanticSignalChanged,
					laneChanged,
					laneDeltaSummary,
					semanticCaraConfig: hybrid.semanticCaraConfig,
					semanticCara: hybrid.semanticCara,
					promptMessages: hybrid.messages,
				})
			},
		},
		{
			name: "balloon_run_staged_cycle",
			title: "Run Staged Balloon Cycle",
			description: "Runs the first staged multi-balloon external prototype with early, mid, and deep stages plus similarity-gated release.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					turns: {
						type: "array",
						description: "Optional turns to replace or append before running the staged cycle.",
						items: {
							type: "object",
							required: ["role", "content"],
							properties: {
								role: { type: "string", enum: ["user", "assistant", "system"] },
								content: { type: "string" },
								timestamp: { type: "string" },
							},
						},
					},
					mergeMode: { type: "string", enum: ["replace", "append"], description: "Whether provided turns replace or append." },
					userRequest: { type: "string", description: "Optional explicit user request to repair against." },
					latestResponse: { type: "string", description: "Optional explicit latest assistant response to audit before building the staged cycle." },
					stageThresholds: { type: "array", description: "Optional turn thresholds for early, mid, and deep stages.", items: { type: "number" } },
					forceStageCount: { type: "number", description: "Optional override to force 1-3 stages active for demos or benchmarks." },
					semanticMode: { type: "string", enum: ["off", "shadow", "assist"], description: "Optional semantic mode forwarded to the repair bundle." },
					semanticAdapterPath: { type: "string", description: "Optional semantic adapter path for assist mode." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic notes returned." },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const incomingTurns = asTurns(args.turns)
				if (incomingTurns.length > 0) {
					const mergeMode = asString(args.mergeMode) === "append" ? "append" : "replace"
					if (mergeMode === "replace") context.store.replaceTurns(sessionId, incomingTurns)
					else context.store.appendTurns(sessionId, incomingTurns)
				}
				const staged = buildStagedBalloonResult(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticMode: args.semanticMode,
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
					stageThresholds: args.stageThresholds,
					forceStageCount: args.forceStageCount,
				})
				if (!staged) return toolError(`Could not build a staged Balloon cycle for session ${sessionId}.`)
				const pressureSnapshot = persistDriftPressureSnapshot(context.store, {
					sessionId,
					source: "staged_cycle",
					turnCount: staged.turnCount,
					requestText: asString(args.userRequest) ?? null,
					latestResponse: asString(args.latestResponse) ?? null,
					pressure: staged.driftPressure,
				})
				const pressureHistory = buildDriftPressureHistorySummary(context.store, sessionId)
				const text = ["Balloon staged cycle complete.", "", formatStagedResult(staged)].join("\n")
				return textResult(text, {
					sessionId,
					turnCount: staged.turnCount,
					thresholds: staged.thresholds,
					forcedStageCount: staged.forcedStageCount,
					activeStageCount: staged.activeStageCount,
					driftPressure: staged.driftPressure,
					pressureSnapshot,
					pressureHistory,
					stages: staged.stages,
					releasePacket: staged.releasePacket,
					deterministicReply: staged.deterministicReply,
					stagedReply: staged.stagedReply,
					deterministicCorrectionSummary: staged.deterministicCorrectionSummary,
					stagedCorrectionSummary: staged.stagedCorrectionSummary,
				})
			},
		},
		{
			name: "balloon_compare_benchmark_lanes",
			title: "Compare Benchmark Lanes",
			description: "Compares baseline, deterministic Balloon, assist Balloon, and staged external Balloon lanes for the same session.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					userRequest: { type: "string", description: "Optional explicit user request to repair against." },
					latestResponse: { type: "string", description: "Optional explicit latest assistant response to audit before building the comparison." },
					semanticAdapterPath: { type: "string", description: "Optional semantic adapter path for the assist lane." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic notes returned." },
					forceStageCount: { type: "number", description: "Optional override to force staged-lane depth. Defaults to 3 for short benchmark scenarios." },
					stageThresholds: { type: "array", description: "Optional staged-lane thresholds.", items: { type: "number" } },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const comparison = buildBenchmarkLaneComparison(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
					forceStageCount: args.forceStageCount ?? 3,
					stageThresholds: args.stageThresholds,
				})
				if (!comparison) return toolError(`Could not build the benchmark comparison for session ${sessionId}.`)
				const text = [
					"Balloon benchmark lane comparison ready.",
					"",
					"Baseline reply",
					comparison.baselineReply,
					"",
					"Deterministic Balloon",
					comparison.deterministicReply,
					"",
					"Assist Balloon",
					comparison.assistReply,
					"",
					"Staged external Balloon",
					comparison.stagedReply,
					"",
					"Lane deltas",
					`Baseline differs from deterministic: ${comparison.baselineDiffers ? "yes" : "no"}`,
					`Assist differs from deterministic: ${comparison.assistDiffers ? "yes" : "no"}`,
					`Staged differs from deterministic: ${comparison.stagedDiffers ? "yes" : "no"}`,
					`Assist semantic status: ${comparison.assistSemanticCara.status}`,
					`Staged active stages: ${comparison.stagedActiveStageCount}`,
					"",
					"Staged release packet",
					formatReleasePacket(comparison.stagedReleasePacket),
				].join("\n")
				return textResult(text, comparison as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_score_benchmark_lanes",
			title: "Score Benchmark Lanes",
			description: "Scores baseline, deterministic, assist, and staged Balloon lanes on the standard six-dimension Balloon scorecard.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					userRequest: { type: "string", description: "Optional explicit user request to score against." },
					latestResponse: { type: "string", description: "Optional explicit latest assistant response to audit before scoring." },
					semanticAdapterPath: { type: "string", description: "Optional semantic adapter path for the assist lane." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic notes returned." },
					forceStageCount: { type: "number", description: "Optional override to force staged-lane depth. Defaults to 3 for short benchmark scenarios." },
					stageThresholds: { type: "array", description: "Optional staged-lane thresholds.", items: { type: "number" } },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const scorecard = buildBenchmarkScorecard(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
					forceStageCount: args.forceStageCount ?? 3,
					stageThresholds: args.stageThresholds,
				})
				if (!scorecard) return toolError(`Could not build the benchmark scorecard for session ${sessionId}.`)
				return textResult(formatBenchmarkScorecard(scorecard), scorecard as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_run_long_session_benchmark",
			title: "Run Long-Session Benchmark",
			description: "Runs checkpointed baseline, deterministic, assist, and staged Balloon comparisons across a longer stored session.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					turns: {
						type: "array",
						description: "Optional turns to replace or append before running checkpointed long-session comparison.",
						items: {
							type: "object",
							required: ["role", "content"],
							properties: {
								role: { type: "string", enum: ["user", "assistant", "system"] },
								content: { type: "string" },
								timestamp: { type: "string" },
							},
						},
					},
					mergeMode: { type: "string", enum: ["replace", "append"], description: "Whether provided turns replace or append." },
					checkpoints: { type: "array", description: "Optional checkpoint turn counts. Defaults to 10, 25, 50.", items: { type: "number" } },
					checkpointMode: {
						type: "string",
						enum: ["turn_count", "assistant_checkpoint"],
						description: "Interpret checkpoints as raw turn counts or as assistant-turn ordinals.",
					},
					semanticAdapterPath: { type: "string", description: "Optional semantic adapter path for the assist lane." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic notes returned." },
					forceStageCount: { type: "number", description: "Optional stage override for demos or controlled reruns." },
					stageThresholds: { type: "array", description: "Optional staged-lane thresholds.", items: { type: "number" } },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const benchmark = buildLongSessionBenchmarkResult(context.store, sessionId, {
					turns: asTurns(args.turns),
					mergeMode: asString(args.mergeMode),
					checkpoints: args.checkpoints,
					checkpointMode: args.checkpointMode,
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
					forceStageCount: args.forceStageCount,
					stageThresholds: args.stageThresholds,
				})
				if (!benchmark) {
					return toolError(`Could not build the long-session benchmark for ${sessionId}. Make sure the session has user and assistant turns at the requested checkpoints.`)
				}
				const assistChangedCount = benchmark.executedCheckpoints.filter((entry) => entry.comparison.assistDiffers).length
				const stagedChangedCount = benchmark.executedCheckpoints.filter((entry) => entry.comparison.stagedDiffers).length
				const text = [
					"Balloon long-session benchmark ready.",
					"",
					`Base session: ${sessionId}`,
					`Total turns: ${benchmark.totalTurnCount}`,
					`Requested checkpoints: ${benchmark.requestedCheckpoints.join(", ")}`,
					`Checkpoint mode: ${benchmark.checkpointMode}`,
					"",
					"Pressure history",
					formatDriftPressureHistory(benchmark.pressureHistory),
					"",
					`Executed checkpoints: ${benchmark.executedCheckpoints.map((entry) => entry.actualTurnCount).join(", ")}`,
					`Assist changed deterministic at checkpoints: ${assistChangedCount}/${benchmark.executedCheckpoints.length}`,
					`Staged changed deterministic at checkpoints: ${stagedChangedCount}/${benchmark.executedCheckpoints.length}`,
					"",
					...benchmark.executedCheckpoints.flatMap((entry, index) => [`Checkpoint ${index + 1}`, formatLongSessionCheckpoint(entry), ""]),
				].join("\n")
				return textResult(text, {
					sessionId: benchmark.sessionId,
					totalTurnCount: benchmark.totalTurnCount,
					requestedCheckpoints: benchmark.requestedCheckpoints,
					checkpointMode: benchmark.checkpointMode,
					executedCheckpoints: benchmark.executedCheckpoints,
					pressureHistory: benchmark.pressureHistory,
					forceStageCount: benchmark.forceStageCount,
				})
			},
		},
		{
			name: "balloon_score_long_session_benchmark",
			title: "Score Long-Session Benchmark",
			description: "Runs checkpointed long-session benchmarking and scores every checkpoint with the standard Balloon scorecard.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
					turns: {
						type: "array",
						description: "Optional turns to replace or append before running checkpointed long-session scoring.",
						items: {
							type: "object",
							required: ["role", "content"],
							properties: {
								role: { type: "string", enum: ["user", "assistant", "system"] },
								content: { type: "string" },
								timestamp: { type: "string" },
							},
						},
					},
					mergeMode: { type: "string", enum: ["replace", "append"], description: "Whether provided turns replace or append." },
					checkpoints: { type: "array", description: "Optional checkpoint turn counts. Defaults to 10, 25, 50.", items: { type: "number" } },
					checkpointMode: {
						type: "string",
						enum: ["turn_count", "assistant_checkpoint"],
						description: "Interpret checkpoints as raw turn counts or as assistant-turn ordinals.",
					},
					semanticAdapterPath: { type: "string", description: "Optional semantic adapter path for the assist lane." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic notes returned." },
					forceStageCount: { type: "number", description: "Optional stage override for demos or controlled reruns." },
					stageThresholds: { type: "array", description: "Optional staged-lane thresholds.", items: { type: "number" } },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const result = buildLongSessionBenchmarkScoreResult(context.store, sessionId, {
					turns: asTurns(args.turns),
					mergeMode: asString(args.mergeMode),
					checkpoints: args.checkpoints,
					checkpointMode: args.checkpointMode,
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
					forceStageCount: args.forceStageCount,
					stageThresholds: args.stageThresholds,
				})
				if (!result) return toolError(`Could not build the long-session score summary for ${sessionId}.`)
				return textResult(formatLongSessionBenchmarkScoreResult(result), result as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_prepare_host_setup_packet",
			title: "Prepare Host Setup Packet",
			description: "Builds a host-specific Balloon MCP config packet with the right command, args, restart hints, and tool-first fallback guidance.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target MCP host or host family.",
					},
					repoPath: { type: "string", description: "Optional local Balloon repo path. Defaults to the server process cwd." },
					dataDir: { type: "string", description: "Optional Balloon data directory passed to --data-dir." },
					serverName: { type: "string", description: "Optional MCP server entry name. Defaults to balloon-mcp." },
					preferWorkspaceVariable: {
						type: "boolean",
						description: "For VS Code, whether to prefer ${workspaceFolder} instead of an absolute cwd when repoPath is not explicit.",
					},
					semanticCaraMode: {
						type: "string",
						enum: ["off", "shadow", "assist"],
						description: "Optional semantic CARA mode for the generated startup args.",
					},
					semanticCaraAdapter: { type: "string", description: "Optional semantic adapter path for assist mode." },
					semanticCaraTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticCaraMaxNotes: { type: "number", description: "Optional semantic max notes cap." },
				},
			},
			run: (args) => {
				const packet = buildHostSetupPacket({
					host: args.host,
					repoPath: args.repoPath,
					dataDir: args.dataDir,
					serverName: args.serverName,
					preferWorkspaceVariable: args.preferWorkspaceVariable,
					semanticCaraMode: args.semanticCaraMode,
					semanticCaraAdapter: args.semanticCaraAdapter,
					semanticCaraTimeoutMs: args.semanticCaraTimeoutMs,
					semanticCaraMaxNotes: args.semanticCaraMaxNotes,
				})
				return textResult(formatHostSetupPacket(packet), packet as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_validate_host_setup",
			title: "Validate Host Setup",
			description: "Validates a Balloon MCP host config file or inline JSON snippet and explains the safest fixes when paths or config roots are off.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target MCP host or host family.",
					},
					configPath: { type: "string", description: "Optional path to a host config file to validate." },
					configJson: { type: "string", description: "Optional inline JSON config snippet to validate." },
					repoPath: { type: "string", description: "Optional local Balloon repo path used to resolve ${workspaceFolder} or cwd-relative paths." },
					serverName: { type: "string", description: "Optional MCP server entry name. Defaults to balloon-mcp." },
				},
			},
			run: (args) => {
				const result = buildHostSetupValidation({
					host: args.host,
					configPath: args.configPath,
					configJson: args.configJson,
					repoPath: args.repoPath,
					serverName: args.serverName,
				})
				const formatter = formatHostSetupValidation(result)
				if (!result.valid) return toolError(formatter, result as unknown as JsonRecord)
				return textResult(formatter, result as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_run_install_diagnostics",
			title: "Run Install Diagnostics",
			description: "Runs a Balloon install doctor pass for a repo or host config and explains the next fixes before strangers should trust the setup.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Optional host or host family to diagnose. When omitted, Balloon checks repo-level readiness only.",
					},
					repoPath: { type: "string", description: "Optional local Balloon repo path. Defaults to the server process cwd." },
					configPath: { type: "string", description: "Optional path to a host config file to validate during the install doctor pass." },
					configJson: { type: "string", description: "Optional inline host config JSON to validate during the install doctor pass." },
					serverName: { type: "string", description: "Optional MCP server entry name. Defaults to balloon-mcp." },
				},
			},
			run: (args, context) => {
				const result = buildInstallDiagnostics(context.store, {
					host: args.host,
					repoPath: args.repoPath,
					configPath: args.configPath,
					configJson: args.configJson,
					serverName: args.serverName,
				})
				const formatter = formatInstallDiagnostics(result)
				if (!result.overallReady) return toolError(formatter, result as unknown as JsonRecord)
				return textResult(formatter, result as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_prepare_host_flow_packet",
			title: "Prepare Host Flow Packet",
			description: "Builds a host-specific invocation packet for repair, review, benchmark, and install flows so users can stay on the most reliable path when prompt routing is flaky.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["host", "flow"],
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target MCP host or host family.",
					},
					flow: {
						type: "string",
						enum: ["run_cycle", "repair_next_turn", "review_session_drift", "compare_benchmark_lanes", "install_diagnostics"],
						description: "Host flow to prepare.",
					},
					sessionId: { type: "string", description: "Optional Balloon session id. If omitted, placeholder args are returned." },
					userRequest: { type: "string", description: "Optional user request used in repair or demo-oriented flow packets." },
					turns: {
						type: "array",
						description: "Optional turns for the run_cycle flow packet. If omitted, placeholder demo turns are returned.",
						items: {
							type: "object",
							required: ["role", "content"],
							properties: {
								role: { type: "string", enum: ["user", "assistant", "system"] },
								content: { type: "string" },
								timestamp: { type: "string" },
							},
						},
					},
					repoPath: { type: "string", description: "Optional Balloon repo path used for the install_diagnostics flow packet." },
					configPath: { type: "string", description: "Optional host config path used for the install_diagnostics flow packet." },
					configJson: { type: "string", description: "Optional inline host config JSON used for the install_diagnostics flow packet." },
					serverName: { type: "string", description: "Optional MCP server entry name. Defaults to balloon-mcp." },
				},
			},
			run: (args, context) => {
				const packet = buildHostFlowPacket(context.store, {
					host: args.host,
					flow: args.flow,
					sessionId: args.sessionId,
					userRequest: args.userRequest,
					turns: args.turns,
					repoPath: args.repoPath,
					configPath: args.configPath,
					configJson: args.configJson,
					serverName: args.serverName,
				})
				return textResult(formatHostFlowPacket(packet), packet as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_prepare_host_validation_suite",
			title: "Prepare Host Validation Suite",
			description: "Builds the same-chat and fresh-chat validation suite Balloon recommends for checking host reliability without relying on private verbal guidance.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["host"],
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target MCP host or host family.",
					},
					sessionId: { type: "string", description: "Optional Balloon session id. If omitted, placeholder packets are returned." },
					userRequest: { type: "string", description: "Optional user request used in repair-oriented validation cases." },
					turns: {
						type: "array",
						description: "Optional turns used to seed the same-chat validation cases.",
						items: {
							type: "object",
							required: ["role", "content"],
							properties: {
								role: { type: "string", enum: ["user", "assistant", "system"] },
								content: { type: "string" },
								timestamp: { type: "string" },
							},
						},
					},
					repoPath: { type: "string", description: "Optional Balloon repo path used by the install-doctor case." },
					configPath: { type: "string", description: "Optional host config path used by the install-doctor case." },
					configJson: { type: "string", description: "Optional inline host config JSON used by the install-doctor case." },
					serverName: { type: "string", description: "Optional MCP server entry name. Defaults to balloon-mcp." },
				},
			},
			run: (args, context) => {
				const suite = buildHostValidationSuite(context.store, {
					host: args.host,
					sessionId: args.sessionId,
					userRequest: args.userRequest,
					turns: args.turns,
					repoPath: args.repoPath,
					configPath: args.configPath,
					configJson: args.configJson,
					serverName: args.serverName,
				})
				return textResult(formatHostValidationSuite(suite), suite as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_record_host_validation_result",
			title: "Record Host Validation Result",
			description: "Stores a real host validation outcome so Balloon can build an evidence-backed reliability picture instead of relying on memory or private notes.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["host", "caseId", "status", "summary"],
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target MCP host or host family.",
					},
					caseId: {
						type: "string",
						enum: HOST_VALIDATION_CASE_IDS,
						description: "Validation case id from the built-in host validation suite.",
					},
					status: { type: "string", enum: ["pass", "partial", "fail"], description: "Observed result for the validation case." },
					summary: { type: "string", description: "Short human-readable summary of what happened in the host." },
					findings: { type: "array", description: "Optional concrete findings from the run.", items: { type: "string" } },
					suggestedFixes: { type: "array", description: "Optional concrete follow-up fixes or mitigations.", items: { type: "string" } },
					sessionId: { type: "string", description: "Optional Balloon session id used during the host run." },
					hostVersion: { type: "string", description: "Optional host build or extension version observed during the run." },
					recordedAt: { type: "string", description: "Optional ISO timestamp override for backfilling evidence." },
				},
			},
			run: (args, context) => {
				const host = parseHostKind(args.host)
				const caseId = parseHostValidationCaseId(args.caseId)
				const status = parseHostValidationStatus(args.status)
				const summary = asString(args.summary)
				if (!caseId) return toolError("caseId must be one of the built-in host validation cases.")
				if (!status) return toolError("status must be pass, partial, or fail.")
				if (!summary) return toolError("summary is required.")
				const suite = buildHostValidationSuite(context.store, { host })
				const validationCase = suite.cases.find((entry) => entry.caseId === caseId)
				if (!validationCase) return toolError(`Unknown validation case for ${host}: ${caseId}`)
				const recordedAt = asString(args.recordedAt) ?? new Date().toISOString()
				const evidence: BalloonHostValidationEvidence = {
					runId: `host-validation-${crypto.randomUUID()}`,
					host,
					caseId,
					status,
					chatStateUnderTest: validationCase.chatStateUnderTest,
					summary,
					findings: asStringArray(args.findings),
					suggestedFixes: asStringArray(args.suggestedFixes),
					sessionId: asString(args.sessionId),
					hostVersion: asString(args.hostVersion),
					recordedAt,
				}
				context.store.saveHostValidationEvidence(evidence)
				return textResult(formatHostValidationEvidence(evidence), evidence as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_summarize_host_validation_results",
			title: "Summarize Host Validation Results",
			description: "Rolls up recorded host validation evidence into a per-host reliability summary with coverage, latest status, and open risks.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["host"],
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target MCP host or host family.",
					},
				},
			},
			run: (args, context) => {
				const host = parseHostKind(args.host)
				const summary = buildHostValidationEvidenceSummary(context.store, host)
				return textResult(formatHostValidationEvidenceSummary(summary), summary as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_describe_slopcode_starter_suite",
			title: "Describe SlopCodeBench Starter Suite",
			description: "Returns the verified first-pass SlopCodeBench problems Balloon should use for dataset-backed anti-drift benchmarking.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					datasetRoot: { type: "string", description: "Optional local path to a SlopCodeBench snapshot or clone." },
				},
			},
			run: (args) => {
				const suite = buildSlopCodeStarterSuite(asString(args.datasetRoot) ?? undefined)
				return textResult(formatSlopCodeStarterSuite(suite), suite as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_plan_slopcode_starter_benchmark",
			title: "Plan SlopCodeBench Starter Benchmark",
			description: "Builds the repeatable starter-suite runbook Balloon should use before making dataset-backed anti-slop claims.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					datasetRoot: { type: "string", description: "Optional local path to a SlopCodeBench snapshot or clone." },
				},
			},
			run: (args) => {
				const plan = buildSlopCodeStarterBenchmarkPlan(asString(args.datasetRoot) ?? undefined)
				return textResult(formatSlopCodeStarterBenchmarkPlan(plan), plan as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_summarize_slopcode_starter_suite",
			title: "Summarize SlopCodeBench Starter Suite",
			description: "Scores whatever SCBench starter-suite sessions Balloon has so far and rolls them up into one dataset-backed suite summary.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					datasetRoot: { type: "string", description: "Optional local path to a SlopCodeBench snapshot or clone." },
					problemNames: { type: "array", description: "Optional subset of starter-suite problems to summarize.", items: { type: "string" } },
					semanticAdapterPath: { type: "string", description: "Optional semantic adapter path for the assist lane." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic notes returned." },
					forceStageCount: { type: "number", description: "Optional global stage override. Defaults to each problem's recommended stage count." },
					stageThresholds: { type: "array", description: "Optional global staged-lane thresholds.", items: { type: "number" } },
				},
			},
			run: (args, context) => {
				const summary = buildSlopCodeStarterSuiteSummary(context.store, {
					datasetRoot: asString(args.datasetRoot),
					problemNames: asStringArray(args.problemNames),
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
					forceStageCount: args.forceStageCount,
					stageThresholds: args.stageThresholds,
				})
				return textResult(formatSlopCodeStarterSuiteSummary(summary), summary as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_export_slopcode_starter_artifacts",
			title: "Export SlopCodeBench Starter Artifacts",
			description:
				"Writes starter-suite score summaries, evidence coverage, and per-problem checkpoint artifacts to JSON and Markdown files for repo-backed benchmark tracking.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					datasetRoot: { type: "string", description: "Optional local path to a SlopCodeBench snapshot or clone." },
					problemNames: { type: "array", description: "Optional subset of starter-suite problems to export.", items: { type: "string" } },
					outputDir: { type: "string", description: "Optional output directory for the exported artifact bundle." },
					semanticAdapterPath: { type: "string", description: "Optional semantic adapter path for the assist lane." },
					semanticTimeoutMs: { type: "number", description: "Optional semantic adapter timeout in milliseconds." },
					semanticMaxNotes: { type: "number", description: "Optional cap on semantic notes returned." },
					forceStageCount: { type: "number", description: "Optional global stage override. Defaults to each problem's recommended stage count." },
					stageThresholds: { type: "array", description: "Optional global staged-lane thresholds.", items: { type: "number" } },
				},
			},
			run: (args, context) => {
				const bundle = buildStarterSuiteArtifactExport(context.store, {
					datasetRoot: asString(args.datasetRoot),
					problemNames: asStringArray(args.problemNames),
					outputDir: asString(args.outputDir),
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
					forceStageCount: args.forceStageCount,
					stageThresholds: args.stageThresholds,
				})
				if (!bundle) {
					return toolError("No scored starter-suite sessions were available to export yet. Run and score at least one starter-suite problem first.")
				}
				const text = [
					"Balloon SCBench starter-suite artifacts exported.",
					"",
					`Output directory: ${bundle.outputDir}`,
					`Covered problems: ${bundle.coveredProblems}/${bundle.totalProblems}`,
					`Problems with live evidence: ${bundle.evidenceSummary.liveCoveredProblems}/${bundle.totalProblems}`,
					`Top lane(s): ${bundle.topLanes.join(", ") || "none"}`,
					`Summary JSON: ${bundle.summaryJsonPath}`,
					`Summary Markdown: ${bundle.summaryMarkdownPath}`,
					"",
					"Evidence risks",
					...(bundle.evidenceAlerts.length > 0 ? bundle.evidenceAlerts.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
					"",
					"Suite pressure alerts",
					...(bundle.pressureAlerts.length > 0 ? bundle.pressureAlerts.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
					"",
					"Suite regressions",
					...(bundle.regressions.length > 0 ? bundle.regressions.map((note, index) => `${index + 1}. ${note}`) : ["None recorded."]),
					"",
					"Problem artifacts",
					...bundle.problems.flatMap((problem, index) => [
						`${index + 1}. ${problem.problemName}`,
						`Covered: ${problem.covered ? "yes" : "no"}`,
						`Evidence coverage: ${problem.evidenceSummary.coverage}`,
						`JSON: ${problem.jsonPath}`,
						`Markdown: ${problem.markdownPath}`,
						...(problem.evidenceAlerts.length > 0 ? problem.evidenceAlerts.map((note, noteIndex) => `Evidence ${noteIndex + 1}: ${note}`) : []),
						...(problem.pressureAlerts.length > 0 ? problem.pressureAlerts.map((note, noteIndex) => `Pressure ${noteIndex + 1}: ${note}`) : []),
						...(problem.regressions.length > 0 ? problem.regressions.map((note, noteIndex) => `Regression ${noteIndex + 1}: ${note}`) : []),
					]),
				].join("\n")
				return textResult(text, bundle as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_prepare_slopcode_problem",
			title: "Prepare SlopCodeBench Problem",
			description: "Prepares one starter-suite SlopCodeBench problem for Balloon benchmarking, including checkpoint files, scoring focus, and the next compare-lanes prompt.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["problemName"],
				properties: {
					problemName: { type: "string", description: "Starter-suite problem name such as file_backup, execution_server, or trajectory_api." },
					datasetRoot: { type: "string", description: "Optional local path to a SlopCodeBench snapshot or clone." },
				},
			},
			run: (args) => {
				const problemName = asString(args.problemName)
				if (!problemName) return toolError("problemName is required.")
				const preparation = buildSlopCodeProblemPreparation(problemName, asString(args.datasetRoot) ?? undefined)
				if (!preparation) {
					return toolError(`Unknown SlopCodeBench starter-suite problem: ${problemName}. Use balloon_describe_slopcode_starter_suite first.`)
				}
				return textResult(formatSlopCodeProblemPreparation(preparation), preparation as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_prepare_slopcode_live_run_packet",
			title: "Prepare SlopCodeBench Live Run Packet",
			description:
				"Builds the full live-rerun packet for one starter-suite SCBench problem, including host guidance, scoring steps, and the exact live evidence record Balloon expects afterward.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["problemName"],
				properties: {
					problemName: { type: "string", description: "Starter-suite problem name such as file_backup, execution_server, or trajectory_api." },
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target host for the live rerun. Defaults to vscode.",
					},
					sessionId: { type: "string", description: "Optional stable session id for the live rerun. Defaults to the recommended problem session id." },
					datasetRoot: { type: "string", description: "Optional local SlopCodeBench dataset root used for the run." },
					provider: { type: "string", description: "Optional provider you plan to use for the live rerun." },
					model: { type: "string", description: "Optional model you plan to use for the live rerun." },
				},
			},
			run: (args) => {
				const packet = buildSlopCodeLiveRunPacket({
					problemName: args.problemName,
					host: args.host,
					sessionId: args.sessionId,
					datasetRoot: args.datasetRoot,
					provider: args.provider,
					model: args.model,
				})
				if (!packet) {
					return toolError(
						`Unknown SlopCodeBench starter-suite problem: ${asString(args.problemName) ?? "unknown"}. Use balloon_describe_slopcode_starter_suite first.`,
					)
				}
				return textResult(formatSlopCodeLiveRunPacket(packet), packet as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_prepare_slopcode_live_run_batch",
			title: "Prepare SlopCodeBench Live Run Batch",
			description:
				"Builds one batch packet for a whole live SCBench rerun pass so the host, session ids, scoring path, and evidence record plan stay aligned across multiple starter problems.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Target host for the live rerun batch. Defaults to vscode.",
					},
					problemNames: { type: "array", description: "Optional subset of starter-suite problems to include in the batch.", items: { type: "string" } },
					sessionIdPrefix: { type: "string", description: "Optional prefix used to generate stable session ids for every selected problem." },
					datasetRoot: { type: "string", description: "Optional local SlopCodeBench dataset root used for the batch." },
					provider: { type: "string", description: "Optional provider you plan to use for the live rerun batch." },
					model: { type: "string", description: "Optional model you plan to use for the live rerun batch." },
				},
			},
			run: (args) => {
				const batch = buildSlopCodeLiveRunBatchPacket({
					host: args.host,
					problemNames: args.problemNames,
					sessionIdPrefix: args.sessionIdPrefix,
					datasetRoot: args.datasetRoot,
					provider: args.provider,
					model: args.model,
				})
				return textResult(formatSlopCodeLiveRunBatchPacket(batch), batch as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_record_slopcode_run_evidence",
			title: "Record SlopCodeBench Run Evidence",
			description:
				"Stores benchmark evidence for a starter-suite SCBench run and explicitly marks whether it came from a real live LLM host session, a manual replay, a fixture, or a synthetic demo.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["problemName", "sessionId", "evidenceKind", "transcriptSource"],
				properties: {
					problemName: { type: "string", description: "Starter-suite problem name such as file_backup, execution_server, or trajectory_api." },
					sessionId: { type: "string", description: "Balloon session id for the recorded run." },
					evidenceKind: {
						type: "string",
						enum: ["live_llm", "manual_replay", "fixture", "synthetic_demo"],
						description: "Whether the evidence came from a real live LLM run or from a non-live replay/demo path.",
					},
					transcriptSource: {
						type: "string",
						enum: ["live_host_session", "pasted_turns", "fixture_turns", "generated_demo"],
						description: "How the turns were captured for this run.",
					},
					host: {
						type: "string",
						enum: ["vscode", "cline", "roo_code", "claude_desktop", "generic_json"],
						description: "Optional host used for the run when applicable.",
					},
					provider: { type: "string", description: "Optional model provider observed during the run." },
					model: { type: "string", description: "Optional model name observed during the run." },
					datasetRoot: { type: "string", description: "Optional local SlopCodeBench dataset root used for the run." },
					datasetVerificationStatus: {
						type: "string",
						enum: ["verified", "partial", "missing"],
						description: "Optional explicit dataset verification status when backfilling evidence without a local dataset root.",
					},
					checkpointMode: {
						type: "string",
						enum: ["turn_count", "assistant_checkpoint"],
						description: "Optional checkpoint interpretation mode used for the run.",
					},
					checkpoints: { type: "array", description: "Optional checkpoint numbers used for the run.", items: { type: "number" } },
					notes: { type: "array", description: "Optional evidence notes and caveats.", items: { type: "string" } },
					recordedAt: { type: "string", description: "Optional ISO timestamp override for backfilled evidence." },
				},
			},
			run: (args, context) => {
				const problemName = asString(args.problemName)
				const sessionId = asString(args.sessionId)
				const evidenceKind = parseSlopCodeEvidenceKind(args.evidenceKind)
				const transcriptSource = parseSlopCodeTranscriptSource(args.transcriptSource)
				if (!problemName) return toolError("problemName is required.")
				if (!sessionId) return toolError("sessionId is required.")
				if (!evidenceKind) return toolError("evidenceKind must be live_llm, manual_replay, fixture, or synthetic_demo.")
				if (!transcriptSource) return toolError("transcriptSource must be live_host_session, pasted_turns, fixture_turns, or generated_demo.")
				if (!getSlopCodeStarterSuiteEntries().some((entry) => entry.problemName === problemName)) {
					return toolError(`Unknown SlopCodeBench starter-suite problem: ${problemName}. Use balloon_describe_slopcode_starter_suite first.`)
				}

				const datasetRoot = asString(args.datasetRoot)
				const explicitDatasetVerificationStatus = parseSlopCodeDatasetVerificationStatus(args.datasetVerificationStatus)
				const datasetVerificationStatus = datasetRoot
					? getSlopCodeDatasetStatus(datasetRoot).verificationStatus
					: explicitDatasetVerificationStatus
				const recordedAt = asString(args.recordedAt) ?? new Date().toISOString()
				const evidence: BalloonSlopCodeRunEvidence = {
					runId: `slopcode-evidence-${crypto.randomUUID()}`,
					problemName,
					sessionId,
					evidenceKind,
					transcriptSource,
					host: asString(args.host) ? parseHostKind(args.host) : null,
					provider: asString(args.provider),
					model: asString(args.model),
					datasetRoot: datasetRoot ? toPortablePath(path.resolve(process.cwd(), datasetRoot)) : null,
					datasetVerificationStatus: datasetVerificationStatus ?? null,
					checkpointMode: args.checkpointMode === undefined ? null : parseCheckpointMode(args.checkpointMode),
					checkpoints: asPositiveIntArray(args.checkpoints, []),
					notes: asStringArray(args.notes),
					recordedAt,
				}
				context.store.saveSlopCodeRunEvidence(evidence)
				return textResult(formatSlopCodeRunEvidence(evidence), evidence as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_summarize_slopcode_run_evidence",
			title: "Summarize SlopCodeBench Run Evidence",
			description:
				"Rolls up recorded SCBench evidence so Balloon can distinguish true live LLM results from replay-only or synthetic runs before making benchmark claims.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				properties: {
					problemNames: { type: "array", description: "Optional subset of starter-suite problems to summarize.", items: { type: "string" } },
				},
			},
			run: (args, context) => {
				const requestedProblems = asStringArray(args.problemNames)
				const summary = buildSlopCodeEvidenceSummary(context.store, requestedProblems.length > 0 ? requestedProblems : undefined)
				return textResult(formatSlopCodeEvidenceSummary(summary), summary as unknown as JsonRecord)
			},
		},
		{
			name: "balloon_review_session_drift",
			title: "Review Session Drift",
			description: "Tool-level fallback for the Balloon drift-review prompt. Packages recent gaps, trickles, and the exact review prompt messages without relying on MCP prompt routing.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string", description: "Stable Balloon session id." },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const bundle = buildReviewPromptBundle(context.store, sessionId)
				const turns = context.store.getTurns(sessionId, 100)
				const profile = context.store.getProfile(sessionId) ?? buildStructuredProfile(sessionId, turns)
				const latestUserRequest = findLatestTurnContent(turns, "user")
				const latestResponse = findLatestTurnContent(turns, "assistant")
				const hiddenRequirements =
					latestUserRequest && latestResponse ? detectHiddenRequirements(latestUserRequest, latestResponse).filter((requirement) => !requirement.coveredByResponse) : []
				const driftPressure =
					latestResponse !== undefined
						? buildDriftPressure(sessionId, profile, latestResponse, latestUserRequest, bundle.gaps, hiddenRequirements)
						: null
				const pressureSnapshot =
					driftPressure && latestResponse !== undefined
						? persistDriftPressureSnapshot(context.store, {
								sessionId,
								source: "review",
								turnCount: turns.length,
								requestText: latestUserRequest,
								latestResponse,
								pressure: driftPressure,
							})
						: null
				const pressureHistory = buildDriftPressureHistorySummary(context.store, sessionId)
				const trickleLines = bundle.trickles.map((trickle) => `${trickle.summary} -> ${trickle.priorityInstructions.join("; ")}`)
				const text = [
					"Balloon drift-review packet ready.",
					"",
					"Session summary",
					bundle.summaryText,
					"",
					"Recent gaps",
					formatGaps(bundle.gaps),
					...(driftPressure ? ["", "Drift pressure", formatDriftPressure(driftPressure)] : []),
					"",
					"Pressure history",
					formatDriftPressureHistory(pressureHistory),
					"",
					"Recent proxy trickles",
					formatList(trickleLines, "No recent trickles recorded."),
					"",
					"Review prompt messages",
					formatPromptMessages(bundle.messages),
				].join("\n")
				return textResult(text, {
					sessionId,
					summaryText: bundle.summaryText,
					gaps: bundle.gaps,
					driftPressure,
					pressureSnapshot,
					pressureHistory,
					trickles: bundle.trickles,
					promptMessages: bundle.messages,
				})
			},
		},
		{
			name: "balloon_update_memory_ledger",
			title: "Update Balloon Memory Ledger",
			description: "Reinforces recurring context in the earned-memory proxy ledger.",
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string" },
					items: { type: "array", items: { type: "string" } },
					reason: { type: "string" },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const explicitItems = Array.isArray(args.items) ? args.items.map((value) => asString(value)).filter((value): value is string => value !== null) : []
				const reason = asString(args.reason) ?? "manual reinforcement"
				let items = explicitItems
				if (items.length === 0) {
					const trickle = context.store.getRecentTrickles(sessionId, 1)[0]
					items = trickle?.priorityInstructions ?? []
				}
				if (items.length === 0) return toolError("No items provided and no recent trickle instructions available.")
				const updates = context.store.reinforceMemory(sessionId, items, reason)
				return textResult(`Memory ledger updated.\n${summarizeMemoryPromotion(updates).join("\n")}`, { sessionId, updates })
			},
		},
		{
			name: "balloon_explain_gap_report",
			title: "Explain Gap Report",
			description: "Turns recent Balloon gaps into a human-readable explanation for demos and collaborator onboarding.",
			annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			inputSchema: {
				type: "object",
				required: ["sessionId"],
				properties: {
					sessionId: { type: "string" },
					gapIds: { type: "array", items: { type: "string" } },
				},
			},
			run: (args, context) => {
				const sessionId = asString(args.sessionId)
				if (!sessionId) return toolError("sessionId is required.")
				const gapIds = Array.isArray(args.gapIds) ? args.gapIds.map((value) => asString(value)).filter((value): value is string => value !== null) : []
				const gaps = getActiveGaps(context.store, sessionId, gapIds)
				if (gaps.length === 0) return toolError("No gaps found to explain.")
				const explanation = gaps
					.map(
						(gap, index) =>
							`${index + 1}. ${gap.title}\nSeverity: ${gap.severity}\nWhy it matters: ${gap.description}\nEvidence: ${gap.evidence.join(" | ") || "none"}`,
					)
					.join("\n\n")
				return textResult(explanation, { sessionId, gaps })
			},
		},
	]
}

export function listBalloonResources(store: BalloonStateStore): ResourceDefinition[] {
	const starterSuite = buildSlopCodeStarterSuite()
	const benchmarkResources: ResourceDefinition[] = [
		{
			uri: "balloon://hosts/matrix",
			name: "host-matrix",
			title: "Balloon Host Matrix",
			description: "Current Balloon host readiness tiers, config roots, and first-use guidance.",
			mimeType: "application/json",
		},
		...getHostSurfaceCatalog().map((surface) => ({
			uri: `balloon://hosts/${surface.host}`,
			name: `host-${surface.host}`,
			title: `Balloon Host Surface (${surface.displayName})`,
			description: "Host-specific Balloon MCP guidance, caveats, and tool-first recommendations.",
			mimeType: "application/json",
		})),
		...getHostSurfaceCatalog().map((surface) => ({
			uri: `balloon://hosts/${surface.host}/playbook`,
			name: `host-${surface.host}-playbook`,
			title: `Balloon Host Playbook (${surface.displayName})`,
			description: "Host-specific Balloon flow packets for install, repair, review, and benchmark paths.",
			mimeType: "application/json",
		})),
		...getHostSurfaceCatalog().map((surface) => ({
			uri: `balloon://hosts/${surface.host}/validation-suite`,
			name: `host-${surface.host}-validation-suite`,
			title: `Balloon Host Validation Suite (${surface.displayName})`,
			description: "Host-specific same-chat and fresh-chat validation suite for Balloon MCP.",
			mimeType: "application/json",
		})),
		...getHostSurfaceCatalog().map((surface) => ({
			uri: `balloon://hosts/${surface.host}/validation-evidence`,
			name: `host-${surface.host}-validation-evidence`,
			title: `Balloon Host Validation Evidence (${surface.displayName})`,
			description: "Recorded host validation evidence and reliability summary for Balloon MCP.",
			mimeType: "application/json",
		})),
		{
			uri: "balloon://benchmark/slopcode/starter-suite",
			name: "slopcode-starter-suite",
			title: "Balloon SlopCodeBench Starter Suite",
			description: "Verified first-pass SlopCodeBench problems recommended for Balloon anti-drift benchmarking.",
			mimeType: "application/json",
		},
		{
			uri: "balloon://benchmark/slopcode/starter-suite/runbook",
			name: "slopcode-starter-runbook",
			title: "Balloon SlopCodeBench Starter Runbook",
			description: "Repeatable starter-suite benchmark plan with prompts, scoring focus, and communication boundaries.",
			mimeType: "application/json",
		},
		{
			uri: "balloon://benchmark/slopcode/live-run-playbook",
			name: "slopcode-live-run-playbook",
			title: "Balloon SlopCodeBench Live Run Playbook",
			description: "Generic host/problem guidance for collecting true live SCBench evidence instead of replay-only traces.",
			mimeType: "application/json",
		},
		{
			uri: "balloon://benchmark/slopcode/live-run-batch",
			name: "slopcode-live-run-batch",
			title: "Balloon SlopCodeBench Live Run Batch",
			description: "Default batch packet for running the full starter-suite live rerun pass in one host.",
			mimeType: "application/json",
		},
		{
			uri: "balloon://benchmark/slopcode/evidence",
			name: "slopcode-evidence",
			title: "Balloon SlopCodeBench Evidence",
			description: "Recorded SCBench evidence showing which runs are live LLM results versus replay-only or synthetic runs.",
			mimeType: "application/json",
		},
		...starterSuite.entries.map((entry) => ({
			uri: `balloon://benchmark/slopcode/evidence/${entry.problemName}`,
			name: `slopcode-evidence-${entry.problemName}`,
			title: `SlopCodeBench Evidence (${entry.problemName})`,
			description: "Per-problem SCBench evidence summary with live versus non-live coverage.",
			mimeType: "application/json",
		})),
		...starterSuite.entries.map((entry) => ({
			uri: `balloon://benchmark/slopcode/problems/${entry.problemName}`,
			name: `slopcode-${entry.problemName}`,
			title: `SlopCodeBench Starter Problem (${entry.problemName})`,
			description: "Preparation packet for a starter-suite SlopCodeBench problem.",
			mimeType: "application/json",
		})),
	]
	return [
		...benchmarkResources,
		...store.listSessionSummaries().flatMap((summary) => [
		{
			uri: `balloon://sessions/${summary.sessionId}/summary`,
			name: `${summary.sessionId}-summary`,
			title: `Balloon Session Summary (${summary.sessionId})`,
			description: "High-level Balloon session summary.",
			mimeType: "application/json",
		},
		{
			uri: `balloon://sessions/${summary.sessionId}/profile`,
			name: `${summary.sessionId}-profile`,
			title: `Balloon Profile (${summary.sessionId})`,
			description: "Structured user and project profile.",
			mimeType: "application/json",
		},
		{
			uri: `balloon://sessions/${summary.sessionId}/gaps`,
			name: `${summary.sessionId}-gaps`,
			title: `Balloon Gap Ledger (${summary.sessionId})`,
			description: "Recent CARA gap reports.",
			mimeType: "application/json",
		},
		{
			uri: `balloon://sessions/${summary.sessionId}/pressure`,
			name: `${summary.sessionId}-pressure`,
			title: `Balloon Drift Pressure History (${summary.sessionId})`,
			description: "Recent Balloon drift-pressure snapshots and trend summary.",
			mimeType: "application/json",
		},
		{
			uri: `balloon://sessions/${summary.sessionId}/trickles`,
			name: `${summary.sessionId}-trickles`,
			title: `Balloon Trickle Ledger (${summary.sessionId})`,
			description: "Recent proxy trickles.",
			mimeType: "application/json",
		},
		{
			uri: `balloon://sessions/${summary.sessionId}/memory`,
			name: `${summary.sessionId}-memory`,
			title: `Balloon Memory Ledger (${summary.sessionId})`,
			description: "Earned-memory proxy ledger entries.",
			mimeType: "application/json",
		},
		{
			uri: `balloon://sessions/${summary.sessionId}/releases`,
			name: `${summary.sessionId}-releases`,
			title: `Balloon Release Ledger (${summary.sessionId})`,
			description: "Recent similarity-gated release packets.",
			mimeType: "application/json",
		},
		]),
	]
}

export function readBalloonResource(store: BalloonStateStore, uri: string): ResourceContent | null {
	if (uri === "balloon://hosts/matrix") {
		return { uri, mimeType: "application/json", text: JSON.stringify(getHostSurfaceCatalog(), null, 2) }
	}
	const hostValidationEvidenceMatch = /^balloon:\/\/hosts\/([^/]+)\/validation-evidence$/u.exec(uri)
	if (hostValidationEvidenceMatch) {
		const host = parseHostKind(hostValidationEvidenceMatch[1] ?? "vscode")
		return { uri, mimeType: "application/json", text: JSON.stringify(buildHostValidationEvidenceSummary(store, host), null, 2) }
	}
	const hostValidationMatch = /^balloon:\/\/hosts\/([^/]+)\/validation-suite$/u.exec(uri)
	if (hostValidationMatch) {
		const host = parseHostKind(hostValidationMatch[1] ?? "vscode")
		return { uri, mimeType: "application/json", text: JSON.stringify(buildHostValidationSuite(store, { host }), null, 2) }
	}
	const hostPlaybookMatch = /^balloon:\/\/hosts\/([^/]+)\/playbook$/u.exec(uri)
	if (hostPlaybookMatch) {
		const host = parseHostKind(hostPlaybookMatch[1] ?? "vscode")
		return { uri, mimeType: "application/json", text: JSON.stringify(buildHostPlaybook(store, host), null, 2) }
	}
	const hostMatch = /^balloon:\/\/hosts\/([^/]+)$/u.exec(uri)
	if (hostMatch) {
		const surface = getHostSurface(parseHostKind(hostMatch[1] ?? "vscode"))
		return { uri, mimeType: "application/json", text: JSON.stringify(surface, null, 2) }
	}
	if (uri === "balloon://benchmark/slopcode/starter-suite") {
		return { uri, mimeType: "application/json", text: JSON.stringify(buildSlopCodeStarterSuite(), null, 2) }
	}
	if (uri === "balloon://benchmark/slopcode/starter-suite/runbook") {
		return { uri, mimeType: "application/json", text: JSON.stringify(buildSlopCodeStarterBenchmarkPlan(), null, 2) }
	}
	if (uri === "balloon://benchmark/slopcode/live-run-playbook") {
		return { uri, mimeType: "application/json", text: JSON.stringify(buildSlopCodeLiveRunPlaybook(), null, 2) }
	}
	if (uri === "balloon://benchmark/slopcode/live-run-batch") {
		return { uri, mimeType: "application/json", text: JSON.stringify(buildSlopCodeLiveRunBatchPacket({}), null, 2) }
	}
	if (uri === "balloon://benchmark/slopcode/evidence") {
		return { uri, mimeType: "application/json", text: JSON.stringify(buildSlopCodeEvidenceSummary(store), null, 2) }
	}
	const evidenceMatch = /^balloon:\/\/benchmark\/slopcode\/evidence\/([^/]+)$/u.exec(uri)
	if (evidenceMatch) {
		const problemName = evidenceMatch[1] ?? ""
		const summary = buildSlopCodeEvidenceSummary(store, [problemName])
		if (summary.problems.length === 0) return null
		return { uri, mimeType: "application/json", text: JSON.stringify(summary, null, 2) }
	}
	const problemMatch = /^balloon:\/\/benchmark\/slopcode\/problems\/([^/]+)$/u.exec(uri)
	if (problemMatch) {
		const problemName = problemMatch[1] ?? ""
		const preparation = buildSlopCodeProblemPreparation(problemName)
		if (!preparation) return null
		return { uri, mimeType: "application/json", text: JSON.stringify(preparation, null, 2) }
	}
	const match = /^balloon:\/\/sessions\/([^/]+)\/(summary|profile|gaps|pressure|trickles|memory|releases)$/u.exec(uri)
	if (!match) return null
	const sessionId = match[1] ?? ""
	const resourceName = match[2] ?? ""
	switch (resourceName) {
		case "summary": {
			const summary = store.getSessionSummary(sessionId)
			if (!summary) return null
			return { uri, mimeType: "application/json", text: JSON.stringify(summary, null, 2) }
		}
		case "profile": {
			const profile = store.getProfile(sessionId)
			if (!profile) return null
			return { uri, mimeType: "application/json", text: JSON.stringify(profile, null, 2) }
		}
		case "gaps":
			return { uri, mimeType: "application/json", text: JSON.stringify(store.getRecentGaps(sessionId, 20), null, 2) }
		case "pressure":
			return {
				uri,
				mimeType: "application/json",
				text: JSON.stringify(
					{
						summary: buildDriftPressureHistorySummary(store, sessionId),
						snapshots: store.listDriftPressureSnapshots(sessionId, 20),
					},
					null,
					2,
				),
			}
		case "trickles":
			return { uri, mimeType: "application/json", text: JSON.stringify(store.getRecentTrickles(sessionId, 20), null, 2) }
		case "memory":
			return { uri, mimeType: "application/json", text: JSON.stringify(store.getMemoryLedger(sessionId), null, 2) }
		case "releases":
			return { uri, mimeType: "application/json", text: JSON.stringify(store.getRecentReleasePackets(sessionId, 20), null, 2) }
		default:
			return null
	}
}

export class BalloonToolRegistry {
	private readonly definitions: ToolDefinition[]
	private readonly context: ToolContext

	constructor(store: BalloonStateStore) {
		this.context = { store }
		this.definitions = buildBalloonToolDefinitions()
	}

	listTools(): Array<{ name: string; title: string; description: string; inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] }; annotations?: Record<string, boolean | string | number> }> {
		return this.definitions.map((definition) => ({
			name: definition.name,
			title: definition.title,
			description: definition.description,
			inputSchema: definition.inputSchema,
			annotations: definition.annotations,
		}))
	}

	callTool(name: string, args: Record<string, unknown>): ToolResult {
		const definition = this.definitions.find((candidate) => candidate.name === name)
		if (!definition) return toolError(`Unknown Balloon tool: ${name}`)
		return definition.run(args, this.context)
	}
}

export function buildSessionSummaryText(store: BalloonStateStore, sessionId: string): string {
	const summary = store.getSessionSummary(sessionId)
	if (!summary) return `No session found for ${sessionId}.`
	return formatSessionSummary(summary)
}
