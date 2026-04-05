import { auditLatestTurn, buildProxyTrickle, buildStructuredProfile, detectHiddenRequirements, retrieveRelevantTurns } from "./BalloonAnalysis"
import { buildReleasePacket, extractReleasedGuidance } from "./BalloonRelease"
import { mergeSemanticRepair, resolveSemanticCaraConfig, runSemanticCara } from "./BalloonSemanticCARA"
import { BalloonStateStore } from "./BalloonStateStore"
import type {
	BalloonGap,
	HiddenRequirement,
	MemoryLedgerItem,
	ProxyTrickle,
	ReleasePacket,
	SemanticCaraConfig,
	SemanticCaraPacket,
	SemanticCaraResult,
	StructuredProfile,
} from "./types"

export type RepairPromptMessage = {
	role: "user" | "assistant" | "system"
	content: {
		type: "text"
		text: string
	}
}

export type BalloonRepairBundle = {
	sessionId: string
	summaryText: string
	requestText: string
	latestResponse: string | null
	profile: StructuredProfile
	hiddenRequirements: HiddenRequirement[]
	gaps: BalloonGap[]
	trickle: ProxyTrickle | null
	memory: MemoryLedgerItem[]
	releasePacket: ReleasePacket
	nextTurnStance: string[]
	messages: RepairPromptMessage[]
	deterministicReply: string
	repairedReply: string
	deterministicCorrectionSummary: string
	correctionSummary: string
	semanticCaraConfig: SemanticCaraConfig
	semanticCara: SemanticCaraResult
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function formatList(values: string[], fallback: string): string {
	if (values.length === 0) return fallback
	return values.map((value, index) => `${index + 1}. ${value}`).join("\n")
}

function buildSessionSummaryText(store: BalloonStateStore, sessionId: string): string {
	const summary = store.getSessionSummary(sessionId)
	if (!summary) return `Session: ${sessionId}\nTurns: 0\nGaps: 0\nTrickles: 0\nMemory items: 0\nRelease packets: 0\nLast updated: unknown`
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

function buildNextTurnStance(
	profile: StructuredProfile,
	hiddenRequirements: HiddenRequirement[],
	trickle: ProxyTrickle | null,
	releasePacket: ReleasePacket,
): string[] {
	const missingRequirements = hiddenRequirements.filter((requirement) => !requirement.coveredByResponse).map((requirement) => requirement.requirement)
	const releasedGuidance = extractReleasedGuidance(releasePacket, 3)
	const combinedRequirements = Array.from(new Set([...missingRequirements, ...releasedGuidance])).slice(0, 3)
	const architectureDirection = profile.architectureDirection.find((entry) => !profile.protectedAreas.includes(entry))
	return [
		...(profile.protectedAreas[0] ? [`Avoid changing: ${profile.protectedAreas[0]}`] : []),
		...(architectureDirection ? [`Preserve direction: ${architectureDirection}`] : []),
		...(profile.verificationObligations[0] ? [`Verify: ${profile.verificationObligations[0]}`] : []),
		...(combinedRequirements.length > 0 ? [`Include: ${combinedRequirements.join(", ")}`] : []),
		...(trickle?.priorityInstructions[0] ? [`Pressure: ${trickle.priorityInstructions[0]}`] : []),
	].slice(0, 4)
}

function cleanSentence(value: string): string {
	return value.trim().replace(/\s+/g, " ").replace(/[.]+$/u, "")
}

function normalizeQuotedText(value: string): string {
	return value.replace(/[`"'“”]+/gu, "").trim()
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

function isGenericProtectedArea(value: string): boolean {
	return /\bdo not edit files\b/i.test(value) || /\bread-only reasoning test\b/i.test(value)
}

function extractProtectedPath(value: string): string | null {
	const pathMatch = /\b(?:src|app|lib|tests?|docs|scripts)\/[A-Za-z0-9_./-]+/u.exec(value)
	return pathMatch?.[0].replace(/[.,;:]+$/u, "") ?? null
}

function isUserRequestLike(value: string): boolean {
	return /^(please|kindly|i want to|i need to|we want to|we need to|can you|could you)\b/iu.test(value.trim())
}

function normalizeDirectionForReply(value: string): string | null {
	const cleaned = cleanSentence(normalizeQuotedText(value))
	if (cleaned.length === 0) return null
	if (isUserRequestLike(cleaned)) return null
	if (/^protected files?:/iu.test(cleaned)) return null
	if (/^do not edit files/iu.test(cleaned)) return null
	if (/read-only reasoning test/iu.test(cleaned)) return null
	if (/^do not rewrite architecture/iu.test(cleaned)) return "the current architecture"
	if (/^preserve existing architecture/iu.test(cleaned)) return "the existing architecture"
	if (/^preserve the current .+ flow/iu.test(cleaned)) return cleaned.replace(/^preserve\s+/iu, "").trim()
	if (/^preserve the existing .+/iu.test(cleaned)) return cleaned.replace(/^preserve\s+/iu, "").trim()
	if (/^preserve .+/iu.test(cleaned)) return cleaned.replace(/^preserve\s+/iu, "").trim()
	if (/^keep .+ architecture/iu.test(cleaned)) return cleaned.replace(/^keep\s+/iu, "").trim()
	if (/^do not rewrite .+/iu.test(cleaned)) return "the existing structure"
	return null
}

function buildVerificationCarryForward(profile: StructuredProfile): string[] {
	const items = new Set<string>()
	for (const obligation of profile.verificationObligations) {
		const cleaned = cleanSentence(normalizeQuotedText(obligation))
		if (cleaned.length === 0) continue
		if (/tests are required/i.test(cleaned)) {
			items.add("tests for the affected change")
			continue
		}
		if (/include tests/i.test(cleaned)) items.add("tests")
		if (/type safety/i.test(cleaned)) items.add("type safety")
		if (/incident clarity/i.test(cleaned) || /replayability/i.test(cleaned)) {
			items.add(cleaned)
			continue
		}
		items.add(cleaned)
	}
	for (const constraint of profile.constraints) {
		const cleaned = cleanSentence(normalizeQuotedText(constraint))
		if (/type safety/i.test(cleaned)) items.add("type safety")
		if (/include tests/i.test(cleaned) && !/tests? for the affected change/i.test(Array.from(items).join(" "))) items.add("tests")
	}
	return Array.from(items).slice(0, 3)
}

function joinPhraseList(values: string[]): string {
	if (values.length === 0) return ""
	if (values.length === 1) return values[0] ?? ""
	if (values.length === 2) return `${values[0]} and ${values[1]}`
	return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`
}

function buildRepairPromptMessages(
	summary: string,
	profile: StructuredProfile,
	gaps: BalloonGap[],
	trickle: ProxyTrickle | null,
	memory: MemoryLedgerItem[],
	semanticCara: SemanticCaraResult,
	releasePacket: ReleasePacket,
	requestText: string,
): RepairPromptMessage[] {
	const systemSections = [
		"You are preparing the next assistant turn in a Balloon-governed session.",
		"Your job is to restore context fidelity without taking control away from the user.",
		"Use the stored profile, recent gaps, proxy trickle, memory items, and semantic CARA notes as low-volume corrective pressure.",
		"Do not mention Balloon, CARA, auditing, or trickle unless the user explicitly asks.",
		"Prefer the smallest safe reply that gets the session back on track.",
		"",
		"Session summary",
		summary,
		"",
		"Known goals",
		formatList(profile.goals, "No explicit goals recorded."),
		"",
		"Known constraints",
		formatList(profile.constraints, "No explicit constraints recorded."),
		"",
		"Protected areas",
		formatList(profile.protectedAreas, "No protected areas recorded."),
		"",
		"Recent gaps to correct",
		formatList(gaps.map((gap) => `${gap.title}: ${gap.description}`), "No recent gaps recorded."),
		"",
		"Proxy trickle instructions",
		formatList(trickle?.priorityInstructions ?? [], "No proxy trickle instructions recorded."),
		"",
		"Similarity-gated release",
		releasePacket.deliveryText,
		"",
		"Reinforced memory items",
		formatList(memory.map((item) => `${item.itemText} (${item.status})`), "No reinforced memory items recorded."),
		"",
		"Semantic CARA notes",
		formatList(semanticCara.notes, semanticCara.status === "disabled" ? "Semantic CARA disabled." : "No semantic notes recorded."),
		"",
		"Response requirements",
		"1. Answer the current request directly.",
		"2. Preserve established architecture, constraints, and protected areas.",
		"3. Carry forward verification obligations when they matter to correctness.",
		"4. Include material follow-on requirements if the current reply would otherwise miss them.",
		"5. Avoid agreement-heavy filler and avoid broad rewrites unless the stored context explicitly requires them.",
	]

	return [
		{
			role: "system",
			content: {
				type: "text",
				text: systemSections.join("\n"),
			},
		},
		{
			role: "user",
			content: {
				type: "text",
				text: `Write only the next assistant reply for this request while preserving the stored context:\n\n${requestText}\n\nIf the current direction is drifted or unsafe, correct course briefly and propose the next bounded step.`,
			},
		},
	]
}

function buildDeterministicRepairedReply(
	requestText: string,
	profile: StructuredProfile,
	hiddenRequirements: HiddenRequirement[],
	gaps: BalloonGap[],
	nextTurnStance: string[],
	releasePacket: ReleasePacket,
): string {
	const target = extractBoundedTarget(requestText)
	const preservedDirection =
		[...profile.architectureDirection, ...profile.constraints]
			.map((entry) => normalizeDirectionForReply(entry))
			.find((entry): entry is string => entry !== null) ?? null
	const specificProtectedArea = profile.protectedAreas.find((entry) => !isGenericProtectedArea(entry))
	const protectedPath = specificProtectedArea ? extractProtectedPath(specificProtectedArea) : null
	const missingRequirements = hiddenRequirements.filter((requirement) => !requirement.coveredByResponse).map((requirement) => requirement.requirement).slice(0, 3)
	const releasedGuidance = extractReleasedGuidance(releasePacket, 4)
	const verificationNeeds = buildVerificationCarryForward(profile)
	const preserveTypeSafety = verificationNeeds.includes("type safety")
	const hasArchitectureDrift = gaps.some((gap) => gap.type === "architecture_drift" || gap.type === "temporal_drift")

	const sentences: string[] = []

	if (preservedDirection) {
		sentences.push(`I would preserve ${preservedDirection} and keep this change bounded.`)
	} else {
		sentences.push("I would keep this change bounded to the existing direction rather than starting with a broader rewrite.")
	}

	if (target) {
		const targetSentence = hasArchitectureDrift
			? `I would focus directly on the requested change: ${target}, instead of starting with a larger refactor.`
			: `I would focus directly on the requested change: ${target}.`
		sentences.push(targetSentence)
	}

	if (protectedPath) {
		sentences.push(`I would avoid changing ${protectedPath} while making that improvement.`)
	}

	if (preserveTypeSafety) {
		sentences.push("I would keep type safety intact while making that improvement.")
	}

	const followOns = Array.from(new Set([...missingRequirements, ...releasedGuidance, ...verificationNeeds.filter((value) => value !== "type safety")])).slice(0, 4)
	if (followOns.length > 0) {
		sentences.push(`I would also carry forward ${joinPhraseList(followOns.map((value) => cleanSentence(value)))}.`)
	}

	if (sentences.length === 0 && nextTurnStance.length > 0) {
		sentences.push(`I would follow the stored Balloon guidance: ${joinPhraseList(nextTurnStance.map((entry) => cleanSentence(entry)))}.`)
	}

	return sentences.join(" ")
}

function buildCorrectionSummary(gaps: BalloonGap[], hiddenRequirements: HiddenRequirement[], profile: StructuredProfile, releasePacket: ReleasePacket): string {
	const corrections: string[] = []
	if (gaps.some((gap) => gap.type === "architecture_drift" || gap.type === "temporal_drift")) corrections.push("preserving the earlier architecture direction")
	if (profile.verificationObligations.length > 0 || gaps.some((gap) => gap.type === "constraint_omission")) corrections.push("reintroducing verification obligations")
	if (hiddenRequirements.some((requirement) => !requirement.coveredByResponse)) corrections.push("surfacing missing follow-on requirements")
	if (releasePacket.released.length > 0) corrections.push("releasing similarity-matched corrections from memory and trickle")
	if (gaps.some((gap) => gap.type === "sycophantic_drift")) corrections.push("removing agreement-heavy phrasing")
	if (corrections.length === 0) return "Balloon found little to correct beyond keeping the next reply aligned to the stored session context."
	return `Balloon corrected the path by ${joinPhraseList(corrections)}.`
}

function buildSemanticCaraPacket(bundle: {
	sessionId: string
	requestText: string
	latestResponse: string | null
	summaryText: string
	profile: StructuredProfile
	gaps: BalloonGap[]
	hiddenRequirements: HiddenRequirement[]
	nextTurnStance: string[]
	trickle: ProxyTrickle | null
	memory: MemoryLedgerItem[]
	releasePacket: ReleasePacket
	deterministicReply: string
	deterministicCorrectionSummary: string
}): SemanticCaraPacket {
	return {
		sessionId: bundle.sessionId,
		requestText: bundle.requestText,
		latestResponse: bundle.latestResponse,
		summaryText: bundle.summaryText,
		profile: bundle.profile,
		gaps: bundle.gaps,
		hiddenRequirements: bundle.hiddenRequirements,
		nextTurnStance: bundle.nextTurnStance,
		trickleInstructions: bundle.trickle?.priorityInstructions ?? [],
		retrievalAnchors: bundle.trickle?.retrievalAnchors ?? [],
		memoryItems: [...bundle.memory.map((item) => item.itemText), ...bundle.releasePacket.released.map((item) => item.sourceText)],
		deterministicReply: bundle.deterministicReply,
		correctionSummary: bundle.deterministicCorrectionSummary,
	}
}

export function buildBalloonRepairBundle(
	store: BalloonStateStore,
	sessionId: string,
	options?: {
		userRequest?: string
		latestResponse?: string
		semanticMode?: unknown
		semanticAdapterPath?: unknown
		semanticTimeoutMs?: unknown
		semanticMaxNotes?: unknown
	},
): BalloonRepairBundle | null {
	const turns = store.getTurns(sessionId, 100)
	const profile = buildStructuredProfile(sessionId, turns)
	store.saveProfile(profile)

	const latestUserRequest =
		asString(options?.userRequest) ??
		turns
			.filter((turn) => turn.role === "user")
			.slice(-1)[0]?.content ??
		null
	const latestResponse =
		asString(options?.latestResponse) ??
		turns
			.filter((turn) => turn.role === "assistant")
			.slice(-1)[0]?.content ??
		null

	if (!latestUserRequest) return null

	const hiddenRequirements = detectHiddenRequirements(latestUserRequest, latestResponse ?? undefined).filter((requirement) => !requirement.coveredByResponse)
	const gaps = latestResponse ? auditLatestTurn(sessionId, profile, latestResponse, latestUserRequest) : store.getRecentGaps(sessionId, 5)
	if (gaps.length > 0) store.saveGaps(sessionId, gaps)

	const retrievalQueries = [...gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]), ...hiddenRequirements.map((requirement) => requirement.requirement)]
	const hits = retrieveRelevantTurns(turns, retrievalQueries, 4)
	const trickle = gaps.length > 0 ? buildProxyTrickle(sessionId, gaps, hits) : null
	if (trickle) store.saveTrickle(trickle)

	const memory = store.getMemoryLedger(sessionId).slice(0, 5)
	const releaseQueryText = [
		latestUserRequest,
		...gaps.flatMap((gap) => [gap.title, gap.description, ...gap.suggestedQueries]),
		...hiddenRequirements.map((requirement) => requirement.requirement),
		...profile.verificationObligations,
		...(trickle?.priorityInstructions ?? []),
	].join("\n")
	const releasePacket = buildReleasePacket(sessionId, {
		queryText: releaseQueryText,
		recentTrickles: [
			...(trickle ? [trickle] : []),
			...store.getRecentTrickles(sessionId, 3).filter((candidate) => !trickle || candidate.trickleId !== trickle.trickleId),
		],
		memoryItems: memory,
	})
	store.saveReleasePacket(releasePacket)
	const summaryText = buildSessionSummaryText(store, sessionId)
	const nextTurnStance = buildNextTurnStance(profile, hiddenRequirements, trickle, releasePacket)
	const deterministicReply = buildDeterministicRepairedReply(latestUserRequest, profile, hiddenRequirements, gaps, nextTurnStance, releasePacket)
	const deterministicCorrectionSummary = buildCorrectionSummary(gaps, hiddenRequirements, profile, releasePacket)
	const semanticCaraConfig = resolveSemanticCaraConfig({
		mode: options?.semanticMode,
		adapterPath: options?.semanticAdapterPath,
		timeoutMs: options?.semanticTimeoutMs,
		maxNotes: options?.semanticMaxNotes,
	})
	const semanticCaraPacket = buildSemanticCaraPacket({
		sessionId,
		requestText: latestUserRequest,
		latestResponse: latestResponse ?? null,
		summaryText,
		profile,
		gaps,
		hiddenRequirements,
		nextTurnStance,
		trickle,
		memory,
		releasePacket,
		deterministicReply,
		deterministicCorrectionSummary,
	})
	const semanticCara = runSemanticCara(semanticCaraPacket, semanticCaraConfig)
	const merged = mergeSemanticRepair(semanticCaraPacket, semanticCara)
	const messages = buildRepairPromptMessages(summaryText, profile, gaps, trickle, memory, semanticCara, releasePacket, latestUserRequest)

	return {
		sessionId,
		summaryText,
		requestText: latestUserRequest,
		latestResponse: latestResponse ?? null,
		profile,
		hiddenRequirements,
		gaps,
		trickle,
		memory,
		releasePacket,
		nextTurnStance,
		messages,
		deterministicReply,
		repairedReply: merged.repairedReply,
		deterministicCorrectionSummary,
		correctionSummary: merged.correctionSummary,
		semanticCaraConfig,
		semanticCara,
	}
}
