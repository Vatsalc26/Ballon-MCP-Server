import { buildProxyTrickle, summarizeDriftPressureHistory, retrieveRelevantTurns } from "./BalloonAnalysis"
import { buildBalloonRepairBundle, type BalloonRepairBundle } from "./BalloonRepair"
import { extractReleasedGuidance } from "./BalloonRelease"
import { BalloonStateStore } from "./BalloonStateStore"
import type { BalloonDriftPressureSnapshot, BalloonGap, ReleasePacket, RetrievalHit, StagedBalloonResult, StagedBalloonStage, StagedBalloonStageId } from "./types"

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

type StageActivationSignals = {
	mid: boolean
	deep: boolean
}

type StageActivationDecision = {
	active: boolean
	reason: string
}

type StageActivationPlan = {
	activeStageCount: number
	mid: StageActivationDecision
	deep: StageActivationDecision
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
	return [5, 15, 40]
}

function normalizeForcedStageCount(value: unknown): number | null {
	if (value === null || value === undefined) return null
	return Math.min(3, Math.max(1, asPositiveInt(value, 3)))
}

function joinReasonParts(parts: string[]): string {
	if (parts.length === 0) return ""
	return parts.join(" ")
}

function resolveStageActivationPlan(turnCount: number, thresholds: number[], forcedStageCount: number | null, signals: StageActivationSignals): StageActivationPlan {
	if (forcedStageCount !== null) {
		return {
			activeStageCount: forcedStageCount,
			mid: {
				active: forcedStageCount >= 2,
				reason:
					forcedStageCount >= 2
						? `Forced active for staged benchmark lane (${forcedStageCount} stages).`
						: `Forced off for staged benchmark lane (${forcedStageCount} stage).`,
			},
			deep: {
				active: forcedStageCount >= 3,
				reason:
					forcedStageCount >= 3
						? `Forced active for staged benchmark lane (${forcedStageCount} stages).`
						: `Forced off for staged benchmark lane (${forcedStageCount} stages).`,
			},
		}
	}

	const midCadenceEvery = thresholds[0] ?? 5
	const deepCadenceEvery = thresholds[1] ?? 15
	const deepAlwaysAfter = thresholds[2] ?? 40
	const midCadenceHit = turnCount >= midCadenceEvery && turnCount % midCadenceEvery === 0
	const deepCadenceHit = turnCount >= deepCadenceEvery && turnCount % deepCadenceEvery === 0
	const midAlwaysOn = turnCount >= deepCadenceEvery
	const deepAlwaysOn = turnCount >= deepAlwaysAfter

	let midActive = midAlwaysOn || midCadenceHit || signals.mid || signals.deep
	const deepActive = deepAlwaysOn || deepCadenceHit || signals.deep
	if (deepActive) midActive = true

	const midReasons: string[] = []
	if (midAlwaysOn) midReasons.push(`Session reached sustained mid-depth at turn ${deepCadenceEvery}.`)
	else if (midCadenceHit) midReasons.push(`Turn ${turnCount} hit the ${midCadenceEvery}-turn mid-balloon cadence.`)
	if (signals.mid || signals.deep) midReasons.push("Gap pressure activated the mid balloon for this turn.")

	const deepReasons: string[] = []
	if (deepAlwaysOn) deepReasons.push(`Session reached sustained deep-depth at turn ${deepAlwaysAfter}.`)
	else if (deepCadenceHit) deepReasons.push(`Turn ${turnCount} hit the ${deepCadenceEvery}-turn deep-balloon cadence.`)
	if (signals.deep) deepReasons.push("Persistent or released drift activated the deep balloon early.")

	return {
		activeStageCount: 1 + Number(midActive) + Number(deepActive),
		mid: {
			active: midActive,
			reason:
				midActive
					? joinReasonParts(midReasons)
					: `Waiting for the ${midCadenceEvery}-turn mid-balloon cadence or stronger gap pressure.`,
		},
		deep: {
			active: deepActive,
			reason:
				deepActive
					? joinReasonParts(deepReasons)
					: `Waiting for the ${deepCadenceEvery}-turn deep-balloon cadence, sustained depth at turn ${deepAlwaysAfter}, or persistent drift pressure.`,
		},
	}
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

function uniq(values: string[], limit = 6): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const value of values) {
		const normalized = cleanSentence(value)
		if (!normalized) continue
		const key = normalized.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(normalized)
		if (out.length >= limit) break
	}
	return out
}

function joinActionClauses(values: string[]): string {
	if (values.length === 0) return ""
	if (values.length === 1) return values[0] ?? ""
	return `${values.slice(0, -1).join("; ")}; and ${values[values.length - 1]}`
}

function cleanSentence(value: string): string {
	return value.trim().replace(/\s+/g, " ").replace(/[.]+$/u, "")
}

function stripRequestPrefix(text: string): string {
	return text
		.replace(/^(please|kindly)\s+/iu, "")
		.replace(/^(i want to|i need to|we need to|we want to|can you|could you|help me)\s+/iu, "")
		.trim()
}

function extractBoundedTarget(userRequest: string): string {
	const firstSentence = userRequest.split(/(?<=[.!?])\s+/u)[0] ?? userRequest
	const stripped = stripRequestPrefix(firstSentence)
	const withoutClause = stripped.split(/\bwithout\b/iu)[0]?.trim() ?? stripped
	return cleanSentence(withoutClause)
}

function extractProtectedPath(values: string[]): string | null {
	for (const value of values) {
		const pathMatch = /\b(?:src|app|lib|tests?|docs|scripts)\/[A-Za-z0-9_./-]+/u.exec(value)
		if (pathMatch) return pathMatch[0]?.replace(/[.,;:]+$/u, "") ?? null
	}
	return null
}

function collectVerificationItems(bundle: BalloonRepairBundle): string[] {
	const items = new Set<string>()
	for (const obligation of bundle.profile.verificationObligations) {
		const cleaned = cleanSentence(obligation)
		if (!cleaned) continue
		if (/type safety/iu.test(cleaned)) items.add("type safety")
		if (/\btests?\b/iu.test(cleaned)) items.add("tests")
		if (/incident clarity/iu.test(cleaned)) items.add("incident clarity")
		if (/replayability/iu.test(cleaned)) items.add("replayability")
	}
	for (const constraint of bundle.profile.constraints) {
		const cleaned = cleanSentence(constraint)
		if (/type safety/iu.test(cleaned)) items.add("type safety")
		if (/\btests?\b/iu.test(cleaned)) items.add("tests")
	}
	return Array.from(items).slice(0, 4)
}

function buildSmallestSafeNextStep(
	target: string,
	verificationItems: string[],
	focusRequirements: string[],
	protectedPath: string | null,
): string {
	const clauses: string[] = []
	if (target) clauses.push(`make only this bounded change: ${target}`)
	if (verificationItems.length > 0) clauses.push(`keep ${joinPhraseList(verificationItems)} explicit`)
	if (focusRequirements.length > 0) clauses.push(`account for ${joinPhraseList(focusRequirements.slice(0, 3))}`)
	clauses.push(`leave ${protectedPath ?? "the broader architecture"} alone`)
	return `The smallest safe next step is to ${joinActionClauses(clauses)}.`
}

function buildStageActivationSignals(
	bundle: BalloonRepairBundle,
	releasePacket: ReleasePacket,
	persistentGaps: BalloonGap[],
	recentPressureSnapshots: BalloonDriftPressureSnapshot[],
): StageActivationSignals {
	const highSignalGaps = bundle.gaps.filter((gap) => gap.severity === "high" || gap.type === "architecture_drift" || gap.type === "profile_contradiction").length
	const persistentHighSignal = persistentGaps.filter((gap) => gap.severity === "high" || gap.type === "architecture_drift" || gap.type === "profile_contradiction").length
	const pressureHistory = summarizeDriftPressureHistory(bundle.sessionId, recentPressureSnapshots)
	const sustainedPressure =
		(pressureHistory.latestScore ?? 0) >= 55 ||
		(pressureHistory.averageScore ?? 0) >= 45 ||
		pressureHistory.trend === "rising"
	return {
		mid: bundle.driftPressure.score >= 35 || sustainedPressure || highSignalGaps >= 1 || bundle.hiddenRequirements.length >= 2 || bundle.gaps.length >= 4,
		deep:
			bundle.driftPressure.score >= 65 ||
			bundle.driftPressure.level === "critical" ||
			sustainedPressure ||
			persistentHighSignal >= 1 ||
			persistentGaps.length >= 2 ||
			releasePacket.released.length >= 3 ||
			(bundle.driftPressure.requestCoverage === "weak" && bundle.driftPressure.profileAnchorCoverage !== "strong"),
	}
}

function buildStagedReply(bundle: BalloonRepairBundle, releasePacket: ReleasePacket, activeStages: StagedBalloonStage[]): string {
	const releasedGuidance = extractReleasedGuidance(releasePacket, 4)
	const missingRequirements = bundle.hiddenRequirements.filter((requirement) => !requirement.coveredByResponse).map((requirement) => requirement.requirement)
	const verificationItems = collectVerificationItems(bundle)
	const protectedPath = extractProtectedPath(bundle.profile.protectedAreas)
	const target = extractBoundedTarget(bundle.requestText)
	const replyParts = [bundle.deterministicReply]

	const combinedHints = uniq([...releasedGuidance, ...missingRequirements], 4)
		.filter((entry) => !bundle.deterministicReply.toLowerCase().includes(entry.toLowerCase()))

	if (combinedHints.length > 0) {
		replyParts.push(`I would keep ${joinPhraseList(combinedHints)} explicit in the next step.`)
	}

	if (activeStages.length >= 2) {
		replyParts.push(buildSmallestSafeNextStep(target, verificationItems, combinedHints, protectedPath))
	}

	if (activeStages.length >= 3) {
		replyParts.push("I would only widen scope after that bounded step if the same gap still survives verification.")
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
	return buildStage("early", "Early Balloon", true, forcedStageCount !== null ? `Forced active for staged benchmark lane (${forcedStageCount} stages).` : turnCount >= thresholds[0]! ? `Base external stage runs every turn; the ${thresholds[0]}-turn mid-balloon cadence is now available.` : "Base external stage runs every turn while deeper balloons wait for cadence or pressure.", {
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

function buildMidStage(bundle: BalloonRepairBundle, retrievalHits: RetrievalHit[], decision: StageActivationDecision): StagedBalloonStage {
	if (!decision.active) {
		return buildStage("mid", "Mid Balloon", false, decision.reason)
	}
	const trickle = bundle.gaps.length > 0 ? buildProxyTrickle(bundle.sessionId, bundle.gaps, retrievalHits, bundle.persistentBias) : bundle.trickle
	return buildStage("mid", "Mid Balloon", true, decision.reason, {
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

function buildDeepStage(releasePacket: ReleasePacket, persistentGaps: BalloonGap[], decision: StageActivationDecision): StagedBalloonStage {
	if (!decision.active) {
		return buildStage("deep", "Deep Balloon", false, decision.reason)
	}
	return buildStage("deep", "Deep Balloon", true, decision.reason, {
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

	const retrievalQueries = [
		...bundle.gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]),
		...bundle.hiddenRequirements.map((requirement) => requirement.requirement),
		...bundle.nextTurnStance,
		...bundle.persistentBias.queryBoosts,
	]
	const retrievalHits = retrieveRelevantTurns(turns, retrievalQueries, 5, { bias: bundle.persistentBias })
	const persistentGaps = buildPersistentGaps(store, sessionId)
	const recentPressureSnapshots = store.listDriftPressureSnapshots(sessionId, 6)
	const activationSignals = buildStageActivationSignals(bundle, bundle.releasePacket, persistentGaps, recentPressureSnapshots)
	const activationPlan = resolveStageActivationPlan(turns.length, thresholds, forcedStageCount, activationSignals)

	const activeStages: StagedBalloonStage[] = []
	const earlyStage = buildEarlyStage(bundle, turns.length, thresholds, forcedStageCount)
	activeStages.push(earlyStage)
	const midStage = buildMidStage(bundle, retrievalHits, activationPlan.mid)
	const deepStage = buildDeepStage(bundle.releasePacket, persistentGaps, activationPlan.deep)
	const stages = [earlyStage, midStage, deepStage]
	for (const stage of stages.slice(1)) {
		if (stage.active) activeStages.push(stage)
	}

	const stagedReply = buildStagedReply(bundle, bundle.releasePacket, activeStages)
	const stagedCorrectionSummaryParts = [
		"Balloon staged external prototype applied",
		`${activeStages.length} active stage(s)`,
		`drift pressure ${bundle.driftPressure.level} (${bundle.driftPressure.score}/100)`,
		bundle.releasePacket.released.length > 0 ? `${bundle.releasePacket.released.length} similarity-gated release(s)` : "no released corrections",
	]

	return {
		sessionId,
		turnCount: turns.length,
		thresholds,
		forcedStageCount,
		activeStageCount: activationPlan.activeStageCount,
		driftPressure: bundle.driftPressure,
		stages,
		releasePacket: bundle.releasePacket,
		deterministicReply: bundle.deterministicReply,
		stagedReply,
		deterministicCorrectionSummary: bundle.deterministicCorrectionSummary,
		stagedCorrectionSummary: `${stagedCorrectionSummaryParts.join(", ")}.`,
	}
}
