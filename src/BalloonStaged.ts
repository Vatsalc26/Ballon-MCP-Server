import { buildProxyTrickle, retrieveRelevantTurns } from "./BalloonAnalysis"
import { buildBalloonRepairBundle, type BalloonRepairBundle } from "./BalloonRepair"
import { extractReleasedGuidance } from "./BalloonRelease"
import { BalloonStateStore } from "./BalloonStateStore"
import type { BalloonGap, ReleasePacket, RetrievalHit, StagedBalloonResult, StagedBalloonStage, StagedBalloonStageId } from "./types"

type StagedCycleOptions = {
	userRequest?: string
	latestResponse?: string
	semanticMode?: unknown
	semanticAdapterPath?: unknown
	semanticTimeoutMs?: unknown
	semanticMaxNotes?: unknown
	stageThresholds?: unknown
	forceStageCount?: unknown
}

function asPositiveInt(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value)
	if (typeof value === "string" && /^\d+$/u.test(value)) return Math.max(1, Number.parseInt(value, 10))
	return fallback
}

function normalizeThresholds(value: unknown): number[] {
	if (Array.isArray(value)) {
		const thresholds = value
			.map((entry) => asPositiveInt(entry, Number.NaN))
			.filter((entry) => Number.isFinite(entry) && entry > 0)
			.slice(0, 3)
		if (thresholds.length === 3) return thresholds
	}
	return [3, 6, 10]
}

function normalizeForcedStageCount(value: unknown): number | null {
	if (value === null || value === undefined) return null
	return Math.min(3, Math.max(1, asPositiveInt(value, 3)))
}

function resolveActiveStageCount(turnCount: number, thresholds: number[], forcedStageCount: number | null): number {
	if (forcedStageCount !== null) return forcedStageCount
	if (turnCount >= thresholds[2]!) return 3
	if (turnCount >= thresholds[1]!) return 2
	return 1
}

function buildStage(stageId: StagedBalloonStageId, label: string, active: boolean, reason: string, data?: Partial<StagedBalloonStage>): StagedBalloonStage {
	return {
		stageId,
		label,
		active,
		reason,
		gaps: data?.gaps ?? [],
		hiddenRequirements: data?.hiddenRequirements ?? [],
		retrievalHits: data?.retrievalHits ?? [],
		trickleInstructions: data?.trickleInstructions ?? [],
		releasedCorrections: data?.releasedCorrections ?? [],
		stageSummary: data?.stageSummary ?? `${label} inactive.`,
	}
}

function joinPhraseList(values: string[]): string {
	if (values.length === 0) return ""
	if (values.length === 1) return values[0] ?? ""
	if (values.length === 2) return `${values[0]} and ${values[1]}`
	return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`
}

function cleanSentence(value: string): string {
	return value.trim().replace(/\s+/g, " ").replace(/[.]+$/u, "")
}

function buildStagedReply(bundle: BalloonRepairBundle, releasePacket: ReleasePacket, activeStages: StagedBalloonStage[]): string {
	const releasedGuidance = extractReleasedGuidance(releasePacket, 4)
	const missingRequirements = bundle.hiddenRequirements.filter((requirement) => !requirement.coveredByResponse).map((requirement) => requirement.requirement)
	const replyParts = [bundle.deterministicReply]

	const combinedHints = [...releasedGuidance, ...missingRequirements]
		.map((entry) => cleanSentence(entry))
		.filter((entry) => entry.length > 0)
		.filter((entry) => !bundle.deterministicReply.toLowerCase().includes(entry.toLowerCase()))
		.slice(0, 4)

	if (combinedHints.length > 0) {
		replyParts.push(`I would keep ${joinPhraseList(combinedHints)} explicit in the next step.`)
	}

	if (activeStages.length >= 2 && bundle.profile.protectedAreas.length > 0 && !bundle.deterministicReply.toLowerCase().includes("bounded")) {
		replyParts.push("I would keep the next step tightly bounded rather than widening scope early.")
	}

	return replyParts.join(" ")
}

function buildStageSummary(stage: Pick<StagedBalloonStage, "label" | "gaps" | "hiddenRequirements" | "retrievalHits" | "releasedCorrections">): string {
	const parts = [
		`${stage.label} stage`,
		`${stage.gaps.length} gap(s)`,
		`${stage.hiddenRequirements.length} hidden requirement(s)`,
		`${stage.retrievalHits.length} retrieval hit(s)`,
		`${stage.releasedCorrections.length} released correction(s)`,
	]
	return `${parts.join(", ")}.`
}

function buildPersistentGaps(store: BalloonStateStore, sessionId: string): BalloonGap[] {
	const recent = store.getRecentGaps(sessionId, 12)
	const counts = new Map<string, { gap: BalloonGap; count: number }>()
	for (const gap of recent) {
		const key = `${gap.type}:${gap.title}`.toLowerCase()
		const existing = counts.get(key)
		if (existing) {
			existing.count += 1
			continue
		}
		counts.set(key, { gap, count: 1 })
	}
	return Array.from(counts.values())
		.filter((entry) => entry.count >= 2 || entry.gap.severity === "high")
		.map((entry) => entry.gap)
		.slice(0, 6)
}

function buildEarlyStage(bundle: BalloonRepairBundle, turnCount: number, thresholds: number[], forcedStageCount: number | null): StagedBalloonStage {
	return buildStage("early", "Early Balloon", true, forcedStageCount !== null ? `Forced active for staged benchmark lane (${forcedStageCount} stages).` : turnCount >= thresholds[0]! ? `Turn threshold ${thresholds[0]} reached.` : "Base external stage stays active before deeper thresholds.", {
		gaps: bundle.gaps,
		trickleInstructions: bundle.trickle?.priorityInstructions.slice(0, 3) ?? [],
		stageSummary: buildStageSummary({
			label: "Early Balloon",
			gaps: bundle.gaps,
			hiddenRequirements: [],
			retrievalHits: [],
			releasedCorrections: [],
		}),
	})
}

function buildMidStage(bundle: BalloonRepairBundle, retrievalHits: RetrievalHit[], thresholds: number[], active: boolean): StagedBalloonStage {
	if (!active) {
		return buildStage("mid", "Mid Balloon", false, `Waiting for turn threshold ${thresholds[1]}.`)
	}
	const trickle = bundle.gaps.length > 0 ? buildProxyTrickle(bundle.sessionId, bundle.gaps, retrievalHits) : bundle.trickle
	return buildStage("mid", "Mid Balloon", true, `Turn threshold ${thresholds[1]} reached or stage forced on.`, {
		gaps: bundle.gaps.filter((gap) => gap.severity !== "low"),
		hiddenRequirements: bundle.hiddenRequirements,
		retrievalHits,
		trickleInstructions: trickle?.priorityInstructions.slice(0, 4) ?? [],
		stageSummary: buildStageSummary({
			label: "Mid Balloon",
			gaps: bundle.gaps.filter((gap) => gap.severity !== "low"),
			hiddenRequirements: bundle.hiddenRequirements,
			retrievalHits,
			releasedCorrections: [],
		}),
	})
}

function buildDeepStage(releasePacket: ReleasePacket, persistentGaps: BalloonGap[], thresholds: number[], active: boolean): StagedBalloonStage {
	if (!active) {
		return buildStage("deep", "Deep Balloon", false, `Waiting for turn threshold ${thresholds[2]}.`)
	}
	return buildStage("deep", "Deep Balloon", true, `Turn threshold ${thresholds[2]} reached or stage forced on.`, {
		gaps: persistentGaps,
		hiddenRequirements: [],
		retrievalHits: [],
		trickleInstructions: extractReleasedGuidance(releasePacket, 4),
		releasedCorrections: releasePacket.released,
		stageSummary: buildStageSummary({
			label: "Deep Balloon",
			gaps: persistentGaps,
			hiddenRequirements: [],
			retrievalHits: [],
			releasedCorrections: releasePacket.released,
		}),
	})
}

export function buildStagedBalloonResult(store: BalloonStateStore, sessionId: string, options?: StagedCycleOptions): StagedBalloonResult | null {
	const bundle = buildBalloonRepairBundle(store, sessionId, options)
	if (!bundle) return null

	const turns = store.getTurns(sessionId, 200)
	const thresholds = normalizeThresholds(options?.stageThresholds)
	const forcedStageCount = normalizeForcedStageCount(options?.forceStageCount)
	const activeStageCount = resolveActiveStageCount(turns.length, thresholds, forcedStageCount)

	const retrievalQueries = [
		...bundle.gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]),
		...bundle.hiddenRequirements.map((requirement) => requirement.requirement),
		...bundle.nextTurnStance,
	]
	const retrievalHits = retrieveRelevantTurns(turns, retrievalQueries, 5)
	const persistentGaps = buildPersistentGaps(store, sessionId)

	const activeStages: StagedBalloonStage[] = []
	const earlyStage = buildEarlyStage(bundle, turns.length, thresholds, forcedStageCount)
	activeStages.push(earlyStage)
	const midStage = buildMidStage(bundle, retrievalHits, thresholds, activeStageCount >= 2)
	const deepStage = buildDeepStage(bundle.releasePacket, persistentGaps, thresholds, activeStageCount >= 3)
	const stages = [earlyStage, midStage, deepStage]
	for (const stage of stages.slice(1)) {
		if (stage.active) activeStages.push(stage)
	}

	const stagedReply = buildStagedReply(bundle, bundle.releasePacket, activeStages)
	const stagedCorrectionSummaryParts = [
		"Balloon staged external prototype applied",
		`${activeStages.length} active stage(s)`,
		bundle.releasePacket.released.length > 0 ? `${bundle.releasePacket.released.length} similarity-gated release(s)` : "no released corrections",
	]

	return {
		sessionId,
		turnCount: turns.length,
		thresholds,
		forcedStageCount,
		activeStageCount,
		stages,
		releasePacket: bundle.releasePacket,
		deterministicReply: bundle.deterministicReply,
		stagedReply,
		deterministicCorrectionSummary: bundle.deterministicCorrectionSummary,
		stagedCorrectionSummary: `${stagedCorrectionSummaryParts.join(", ")}.`,
	}
}
