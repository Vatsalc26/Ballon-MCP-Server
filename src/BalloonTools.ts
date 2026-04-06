import type {
	BalloonGap,
	BalloonBenchmarkDimensionScore,
	BalloonBenchmarkLaneTotals,
	BalloonBenchmarkLaneScore,
	BalloonBenchmarkScorecard,
	BalloonBenchmarkScoreDimension,
	BalloonSessionSummary,
	BenchmarkLaneComparison,
	HiddenRequirement,
	LongSessionBenchmarkCheckpoint,
	LongSessionBenchmarkCheckpointScore,
	LongSessionBenchmarkResult,
	LongSessionBenchmarkScoreResult,
	ProxyTrickle,
	ReleasePacket,
	RetrievalHit,
	SemanticCaraResult,
	SlopCodeStarterBenchmarkPlan,
	SlopCodeStarterSuiteSummary,
	SlopCodeProblemPreparation,
	SlopCodeStarterSuiteResult,
	StagedBalloonResult,
	StructuredProfile,
} from "./types"
import { BalloonStateStore } from "./BalloonStateStore"
import { auditLatestTurn, buildProxyTrickle, buildStructuredProfile, detectHiddenRequirements, retrieveRelevantTurns, summarizeMemoryPromotion } from "./BalloonAnalysis"
import { buildBalloonRepairBundle } from "./BalloonRepair"
import { buildReviewPromptBundle } from "./BalloonPrompts"
import { buildStagedBalloonResult } from "./BalloonStaged"
import { buildSlopCodeProblemPreparation, buildSlopCodeStarterBenchmarkPlan, buildSlopCodeStarterSuite, getBenchmarkScoreDimensions } from "./SlopCodeBench"

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
	return hits.map((hit, index) => `${index + 1}. (${hit.role}, score=${hit.score}) ${hit.content}`).join("\n")
}

function formatTrickle(trickle: ProxyTrickle): string {
	return [trickle.summary, "", trickle.deliveryText].join("\n")
}

function formatReleasePacket(packet: ReleasePacket): string {
	const releasedLines =
		packet.released.length > 0
			? packet.released
					.slice(0, 6)
					.map((item, index) => `${index + 1}. ${item.sourceText} [${item.sourceKind}, score=${item.similarityScore.toFixed(2)}, threshold=${item.threshold.toFixed(2)}]`)
			: ["No released corrections."]
	const heldLines =
		packet.held.length > 0
			? packet.held
					.slice(0, 4)
					.map((item, index) => `${index + 1}. ${item.sourceText} [${item.sourceKind}, score=${item.similarityScore.toFixed(2)}, threshold=${item.threshold.toFixed(2)}]`)
			: ["No held corrections."]
	return [
		packet.summary,
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

function buildNextTurnStance(profile: StructuredProfile, hiddenRequirements: HiddenRequirement[], trickle: ProxyTrickle): string[] {
	const missingRequirements = hiddenRequirements.filter((requirement) => !requirement.coveredByResponse).map((requirement) => requirement.requirement)
	const architectureDirection = profile.architectureDirection.find((entry) => !profile.protectedAreas.includes(entry))
	return [
		...(profile.protectedAreas[0] ? [`Avoid changing: ${profile.protectedAreas[0]}`] : []),
		...(architectureDirection ? [`Preserve direction: ${architectureDirection}`] : []),
		...(profile.verificationObligations[0] ? [`Verify: ${profile.verificationObligations[0]}`] : []),
		...(missingRequirements.length > 0 ? [`Include: ${missingRequirements.slice(0, 3).join(", ")}`] : []),
		...(trickle.priorityInstructions[0] ? [`Pressure: ${trickle.priorityInstructions[0]}`] : []),
	].slice(0, 4)
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

function resolveCheckpointTurns(turns: Array<{ role: string; content: string; timestamp?: string }>, requestedCheckpoints: number[]): Array<{ checkpoint: number; actualTurnCount: number }> {
	const resolved: Array<{ checkpoint: number; actualTurnCount: number }> = []
	const seen = new Set<number>()
	for (const checkpoint of [...requestedCheckpoints].sort((left, right) => left - right)) {
		const capped = Math.min(checkpoint, turns.length)
		let index = capped - 1
		while (index >= 0 && turns[index]?.role !== "assistant") index -= 1
		if (index < 0) continue
		const actualTurnCount = index + 1
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
	const checkpointSpecs = resolveCheckpointTurns(
		storedTurns.map((turn) => ({ role: turn.role, content: turn.content, timestamp: turn.timestamp })),
		requestedCheckpoints,
	)
	if (checkpointSpecs.length === 0) return null
	const executedCheckpoints: LongSessionBenchmarkCheckpoint[] = []
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
		executedCheckpoints.push({
			checkpoint: checkpoint.checkpoint,
			actualTurnCount: checkpoint.actualTurnCount,
			checkpointSessionId,
			requestText: comparison.requestText,
			latestResponse: comparison.latestResponse,
			comparison,
		})
	}
	return {
		sessionId,
		totalTurnCount: storedTurns.length,
		requestedCheckpoints,
		executedCheckpoints,
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
		})
		accumulateLaneTotals(laneTotals, scorecard)
	}
	return {
		sessionId: benchmark.sessionId,
		totalTurnCount: benchmark.totalTurnCount,
		requestedCheckpoints: benchmark.requestedCheckpoints,
		executedCheckpoints,
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
		`Top lane(s): ${summary.topLanes.join(", ") || "none"}`,
		`Baseline total: ${summary.laneTotals.baseline}/${summary.laneTotals.maxTotal}`,
		`Deterministic total: ${summary.laneTotals.deterministic}/${summary.laneTotals.maxTotal}`,
		`Assist total: ${summary.laneTotals.assist}/${summary.laneTotals.maxTotal}`,
		`Staged total: ${summary.laneTotals.staged}/${summary.laneTotals.maxTotal}`,
		"",
		...summary.problems.flatMap((problem, index) => [
			`${index + 1}. ${problem.problemName}`,
			`Session id: ${problem.sessionId}`,
			`Session present: ${problem.sessionPresent ? "yes" : "no"}`,
			`Recommended checkpoints: ${problem.recommendedCheckpoints.join(", ")}`,
			`Executed checkpoints: ${problem.executedCheckpoints.length > 0 ? problem.executedCheckpoints.join(", ") : "none"}`,
			...(problem.scoreResult
				? [
						`Top lane(s): ${problem.scoreResult.topLanes.join(", ")}`,
						`Baseline total: ${problem.scoreResult.laneTotals.baseline}/${problem.scoreResult.laneTotals.maxTotal}`,
						`Deterministic total: ${problem.scoreResult.laneTotals.deterministic}/${problem.scoreResult.laneTotals.maxTotal}`,
						`Assist total: ${problem.scoreResult.laneTotals.assist}/${problem.scoreResult.laneTotals.maxTotal}`,
						`Staged total: ${problem.scoreResult.laneTotals.staged}/${problem.scoreResult.laneTotals.maxTotal}`,
					]
				: ["Score summary: not available yet"]),
			...(problem.warnings.length > 0 ? problem.warnings.map((warning, warningIndex) => `Warning ${warningIndex + 1}: ${warning}`) : []),
			"",
		]),
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

				const retrievalLimit = asPositiveInt(args.retrievalLimit, 4)
				const retrievalQueries = [...gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]), ...hiddenRequirements.map((requirement) => requirement.requirement)]
				const hits = retrieveRelevantTurns(storedTurns, retrievalQueries, retrievalLimit)
				const trickle = buildProxyTrickle(sessionId, gaps, hits)
				context.store.saveTrickle(trickle)

				const autoReinforceMemory = typeof args.autoReinforceMemory === "boolean" ? args.autoReinforceMemory : true
				const reason = asString(args.reason) ?? "balloon_run_cycle auto reinforcement"
				const memoryUpdates = autoReinforceMemory ? context.store.reinforceMemory(sessionId, trickle.priorityInstructions, reason) : []
				const nextTurnStance = buildNextTurnStance(profile, hiddenRequirements, trickle)

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
				context.store.saveGaps(sessionId, gaps)
				return textResult(formatGaps(gaps), { sessionId, gapCount: gaps.length, gaps })
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
				const text = [
					"Balloon repair packet ready.",
					"",
					"Suggested repaired next assistant reply",
					bundle.repairedReply,
					"",
					"What Balloon corrected",
					bundle.correctionSummary,
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
					"Semantic CARA",
					formatSemanticCara(bundle.semanticCara),
				].join("\n")
				return textResult(text, {
					sessionId,
					requestText: bundle.requestText,
					latestResponse: bundle.latestResponse,
					profile: bundle.profile,
					gaps: bundle.gaps,
					hiddenRequirements: bundle.hiddenRequirements,
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
				const text = ["Balloon staged cycle complete.", "", formatStagedResult(staged)].join("\n")
				return textResult(text, {
					sessionId,
					turnCount: staged.turnCount,
					thresholds: staged.thresholds,
					forcedStageCount: staged.forcedStageCount,
					activeStageCount: staged.activeStageCount,
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
					executedCheckpoints: benchmark.executedCheckpoints,
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
				const trickleLines = bundle.trickles.map((trickle) => `${trickle.summary} -> ${trickle.priorityInstructions.join("; ")}`)
				const text = [
					"Balloon drift-review packet ready.",
					"",
					"Session summary",
					bundle.summaryText,
					"",
					"Recent gaps",
					formatGaps(bundle.gaps),
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
	if (uri === "balloon://benchmark/slopcode/starter-suite") {
		return { uri, mimeType: "application/json", text: JSON.stringify(buildSlopCodeStarterSuite(), null, 2) }
	}
	if (uri === "balloon://benchmark/slopcode/starter-suite/runbook") {
		return { uri, mimeType: "application/json", text: JSON.stringify(buildSlopCodeStarterBenchmarkPlan(), null, 2) }
	}
	const problemMatch = /^balloon:\/\/benchmark\/slopcode\/problems\/([^/]+)$/u.exec(uri)
	if (problemMatch) {
		const problemName = problemMatch[1] ?? ""
		const preparation = buildSlopCodeProblemPreparation(problemName)
		if (!preparation) return null
		return { uri, mimeType: "application/json", text: JSON.stringify(preparation, null, 2) }
	}
	const match = /^balloon:\/\/sessions\/([^/]+)\/(summary|profile|gaps|trickles|memory|releases)$/u.exec(uri)
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
