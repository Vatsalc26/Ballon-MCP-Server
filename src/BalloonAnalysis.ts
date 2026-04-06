import crypto from "crypto"
import type {
	BalloonCoverageQuality,
	BalloonDriftPressureHistorySummary,
	BalloonDriftPressure,
	BalloonPersistentDriftBias,
	BalloonPersistentDriftFocus,
	BalloonDriftPressureSnapshot,
	BalloonDriftPressureSource,
	BalloonGap,
	BalloonGapSeverity,
	BalloonGapType,
	BalloonTurn,
	HiddenRequirement,
	MemoryLedgerItem,
	ProxyTrickle,
	RetrievalHit,
	StructuredProfile,
} from "./types"

function nowIso(): string {
	return new Date().toISOString()
}

function makeId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`
}

function uniq(values: string[], limit = 8): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const value of values) {
		const normalized = value.trim().replace(/\s+/g, " ")
		if (!normalized) continue
		const key = normalized.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(normalized)
		if (out.length >= limit) break
	}
	return out
}

function splitSentences(text: string): string[] {
	return text
		.split(/\r?\n/g)
		.flatMap((line) => line.split(/(?<=[.!?])\s+/g))
		.map((line) => line.replace(/^[-*]\s*/, "").trim())
		.filter(Boolean)
}

const STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"this",
	"that",
	"from",
	"into",
	"your",
	"you",
	"will",
	"can",
	"would",
	"should",
	"could",
	"please",
	"just",
	"then",
	"than",
	"about",
	"have",
	"has",
	"had",
	"first",
	"later",
	"worry",
	"keep",
	"include",
	"add",
	"make",
	"need",
	"needs",
])

function keywordSet(text: string): string[] {
	return uniq(
		text
			.toLowerCase()
			.replace(/[^a-z0-9_./-]+/g, " ")
			.split(/\s+/g)
			.filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
		20,
	)
}

function overlaps(text: string, candidate: string): string[] {
	const base = new Set(keywordSet(text))
	return keywordSet(candidate).filter((token) => base.has(token))
}

function containsAny(text: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text))
}

function resolveCoverageQuality(matchedCount: number, signalCount: number): BalloonCoverageQuality {
	if (signalCount <= 0) return "strong"
	if (matchedCount <= 0) return "weak"
	if (matchedCount >= Math.min(signalCount, 2)) return "strong"
	return "partial"
}

function suggestsBroadChange(text: string): boolean {
	return containsAny(text, [
		/\brewrite\b/i,
		/\bfrom scratch\b/i,
		/\breplace\b/i,
		/\bswap\b/i,
		/\bnew framework\b/i,
		/\bremove\b/i,
		/\bdelete\b/i,
	])
}

function suggestsEditAction(text: string): boolean {
	return containsAny(text, [/\bedit\b/i, /\bmodify\b/i, /\bchange\b/i, /\bremove\b/i, /\brewrite\b/i, /\bdelete\b/i, /\brename\b/i, /\brefactor\b/i])
}

function suggestsInterfaceChange(text: string): boolean {
	return containsAny(text, [
		/\bpublic api\b/i,
		/\binterface\b/i,
		/\bsignature\b/i,
		/\bschema\b/i,
		/\bcontract\b/i,
		/\bendpoint\b/i,
		/\bbreak(?:ing)?\b/i,
		/\brename\b/i,
	])
}

function pushGapUnique(gaps: BalloonGap[], gap: BalloonGap): void {
	if (gaps.some((existing) => existing.type === gap.type && existing.title === gap.title)) return
	gaps.push(gap)
}

function inferArchitectureDirection(sentence: string): boolean {
	return containsAny(sentence, [/\barchitecture\b/i, /\bpattern\b/i, /\brouter\b/i, /\bservice\b/i, /\bcontroller\b/i, /\bexisting implementation\b/i, /\bcurrent structure\b/i])
}

function inferProtectedArea(sentence: string): boolean {
	return containsAny(sentence, [/\bprotected\b/i, /\bdo not edit\b/i, /\bdon't touch\b/i, /\bexcluded\b/i, /\bkeep .* untouched\b/i, /\bdo not modify\b/i, /\bread[- ]only\b/i, /\b(?:src|app|lib|test|tests|docs|scripts)\/[A-Za-z0-9_./-]+/])
}

function inferVerificationObligation(sentence: string): boolean {
	if (containsAny(sentence, [/\bread-only reasoning test\b/i, /\bthis is a read-only\b/i])) return false
	return containsAny(sentence, [
		/\btests?\s+(are|is)\s+required\b/i,
		/\btests?\b.*\bmatter\b/i,
		/\binclude\b.*\btests?\b/i,
		/\btest coverage\b/i,
		/\bverif(?:y|ication)\b/i,
		/\bvalidation\b/i,
		/\bmigration\b/i,
		/\bdeploy(?:ment)?\b/i,
		/\bsmoke\b/i,
		/\brollback\b/i,
		/\breplayability\b/i,
	])
}

function inferStyleRequirement(sentence: string): boolean {
	return containsAny(sentence, [/\btype(?:-| )safe\b/i, /\btypescript\b/i, /\bstrict typing\b/i, /\bstyle\b/i, /\blint\b/i, /\bformat\b/i, /\bnaming\b/i])
}

function inferConstraint(sentence: string): boolean {
	return containsAny(sentence, [/\bmust\b/i, /\bshould\b/i, /\brequired\b/i, /\bneed to\b/i, /\bdo not\b/i, /\bdon't\b/i, /\bnever\b/i, /\bkeep\b/i, /\bpreserve\b/i, /\bensure\b/i, /\bavoid\b/i])
}

function inferGoal(sentence: string): boolean {
	return containsAny(sentence, [/\bgoal\b/i, /\bwant\b/i, /\bbuild\b/i, /\bcreate\b/i, /\bimplement\b/i, /\badd\b/i, /\bmake\b/i, /\benable\b/i, /\bsupport\b/i])
}

function inferNonGoal(sentence: string): boolean {
	return containsAny(sentence, [/\bnon-goal\b/i, /\bnot a goal\b/i, /\bdo not\b/i, /\bdon't\b/i, /\bavoid\b/i, /\bno need\b/i, /\bwithout\b/i])
}

function inferAssumption(sentence: string): boolean {
	return containsAny(sentence, [/\bassume\b/i, /\balready\b/i, /\bexisting\b/i, /\bcurrent\b/i, /\blegacy\b/i, /\btoday\b/i])
}

function inferProtectedInterface(sentence: string): boolean {
	return containsAny(sentence, [/\bpublic api\b/i, /\binterface\b/i, /\bsignature\b/i, /\bschema\b/i, /\bcontract\b/i, /\btype signature\b/i])
}

export function buildStructuredProfile(sessionId: string, turns: BalloonTurn[]): StructuredProfile {
	const userFacingTurns = turns.filter((turn) => turn.role === "user" || turn.role === "system")
	const sentences = userFacingTurns.flatMap((turn) => splitSentences(turn.content))

	const goals: string[] = []
	const constraints: string[] = []
	const nonGoals: string[] = []
	const protectedAreas: string[] = []
	const protectedInterfaces: string[] = []
	const styleRequirements: string[] = []
	const verificationObligations: string[] = []
	const architectureDirection: string[] = []
	const assumptions: string[] = []

	for (const sentence of sentences) {
		if (inferGoal(sentence)) goals.push(sentence)
		if (inferConstraint(sentence)) constraints.push(sentence)
		if (inferNonGoal(sentence)) nonGoals.push(sentence)
		if (inferProtectedArea(sentence)) protectedAreas.push(sentence)
		if (inferProtectedInterface(sentence)) protectedInterfaces.push(sentence)
		if (inferStyleRequirement(sentence)) styleRequirements.push(sentence)
		if (inferVerificationObligation(sentence)) verificationObligations.push(sentence)
		if (inferArchitectureDirection(sentence)) architectureDirection.push(sentence)
		if (inferAssumption(sentence)) assumptions.push(sentence)
	}

	return {
		sessionId,
		goals: uniq(goals),
		constraints: uniq(constraints),
		nonGoals: uniq(nonGoals),
		protectedAreas: uniq(protectedAreas),
		protectedInterfaces: uniq(protectedInterfaces),
		styleRequirements: uniq(styleRequirements),
		verificationObligations: uniq(verificationObligations),
		architectureDirection: uniq(architectureDirection),
		assumptions: uniq(assumptions),
		updatedAt: nowIso(),
		sourceTurnCount: turns.length,
	}
}

function makeGap(sessionId: string, type: BalloonGapType, severity: BalloonGapSeverity, title: string, description: string, evidence: string[], suggestedQueries: string[]): BalloonGap {
	return {
		gapId: makeId("gap"),
		sessionId,
		type,
		severity,
		title,
		description,
		evidence: uniq(evidence, 6),
		suggestedQueries: uniq(suggestedQueries, 6),
		createdAt: nowIso(),
	}
}

const HIDDEN_REQUIREMENT_PATTERNS: Array<{ key: string; trigger: RegExp[]; expansions: Array<{ requirement: string; rationale: string }> }> = [
	{
		key: "retry",
		trigger: [/\bretry\b/i, /\bbackoff\b/i],
		expansions: [
			{ requirement: "timeout alignment", rationale: "Retry logic usually needs explicit timeout behavior." },
			{ requirement: "idempotency review", rationale: "Retries can duplicate side effects if the operation is not idempotent." },
			{ requirement: "test coverage for repeated failure", rationale: "Retry logic should be verified across failure and recovery paths." },
		],
	},
	{
		key: "rename",
		trigger: [/\brename\b/i, /\bmove\b/i],
		expansions: [
			{ requirement: "import and reference update", rationale: "Renames usually affect downstream references." },
			{ requirement: "test and fixture update", rationale: "Renamed code often breaks tests or fixtures." },
			{ requirement: "documentation update", rationale: "Public or internal names may need to stay aligned in docs." },
		],
	},
	{
		key: "api",
		trigger: [/\bendpoint\b/i, /\bapi\b/i, /\broute\b/i],
		expansions: [
			{ requirement: "validation path", rationale: "New endpoints usually need explicit input validation." },
			{ requirement: "authorization review", rationale: "API changes often interact with access control." },
			{ requirement: "API test coverage", rationale: "Endpoints should be verified through request-level tests." },
		],
	},
	{
		key: "migration",
		trigger: [/\bmigration\b/i, /\bschema\b/i, /\bdatabase\b/i],
		expansions: [
			{ requirement: "rollback path", rationale: "Schema or migration changes need a recovery strategy." },
			{ requirement: "backfill or compatibility check", rationale: "Existing data may need compatibility handling." },
			{ requirement: "migration verification", rationale: "Migration success should be explicitly tested." },
		],
	},
	{
		key: "config",
		trigger: [/\bconfig\b/i, /\benv\b/i, /\bflag\b/i],
		expansions: [
			{ requirement: "default value review", rationale: "Configuration changes often need safe defaults." },
			{ requirement: "documentation update", rationale: "New configuration surfaces should be documented." },
			{ requirement: "validation or failure behavior", rationale: "Bad config needs defined handling." },
		],
	},
]

export function detectHiddenRequirements(latestUserRequest: string, latestResponse?: string): HiddenRequirement[] {
	const responseText = (latestResponse ?? "").toLowerCase()
	const findings: HiddenRequirement[] = []
	for (const pattern of HIDDEN_REQUIREMENT_PATTERNS) {
		if (!pattern.trigger.some((regex) => regex.test(latestUserRequest))) continue
		for (const expansion of pattern.expansions) {
			const coveredByResponse = responseText.includes(expansion.requirement.toLowerCase())
			findings.push({
				key: `${pattern.key}:${expansion.requirement}`.toLowerCase().replace(/[^a-z0-9:]+/g, "_"),
				requirement: expansion.requirement,
				rationale: expansion.rationale,
				coveredByResponse,
			})
		}
	}
	return findings
}

export function auditLatestTurn(sessionId: string, profile: StructuredProfile | null, latestResponse: string, latestUserRequest?: string): BalloonGap[] {
	const response = latestResponse.trim()
	if (!response) {
		return [makeGap(sessionId, "constraint_omission", "high", "Empty latest response", "The latest response is empty, so Balloon cannot evaluate context fidelity.", [], [])]
	}

	const gaps: BalloonGap[] = []
	const responseLower = response.toLowerCase()
	const responseKeywords = new Set(keywordSet(response))

	if (profile) {
		for (const protectedArea of profile.protectedAreas) {
			const matched = overlaps(response, protectedArea)
			if (matched.length > 0 && suggestsEditAction(responseLower)) {
				pushGapUnique(
					gaps,
					makeGap(
						sessionId,
						"profile_contradiction",
						"high",
						"Protected area may be contradicted",
						"The latest response appears to propose modifying an area that profile context marked as protected or excluded.",
						[protectedArea, response],
						[protectedArea],
					),
				)
				break
			}
		}

		for (const protectedInterface of profile.protectedInterfaces.slice(0, 4)) {
			const matched = overlaps(response, protectedInterface)
			if ((matched.length > 0 || suggestsInterfaceChange(responseLower)) && (suggestsInterfaceChange(responseLower) || suggestsEditAction(responseLower))) {
				pushGapUnique(
					gaps,
					makeGap(
						sessionId,
						"profile_contradiction",
						"high",
						"Protected interface may be contradicted",
						"The latest response appears to widen or change an interface or contract that the stored profile marked as protected.",
						[protectedInterface, response],
						[protectedInterface, "existing interface", "public contract"],
					),
				)
				break
			}
		}

		for (const nonGoal of profile.nonGoals.slice(0, 4)) {
			if (overlaps(response, nonGoal).length > 0 && suggestsBroadChange(responseLower)) {
				pushGapUnique(
					gaps,
					makeGap(
						sessionId,
						"profile_contradiction",
						"high",
						"Stored non-goal may be contradicted",
						"The latest response appears to move into work the stored profile previously framed as a non-goal or explicitly excluded direction.",
						[nonGoal, response],
						[nonGoal],
					),
				)
				break
			}
		}

		for (const obligation of profile.verificationObligations.slice(0, 4)) {
			if (overlaps(response, obligation).length === 0) {
				pushGapUnique(
					gaps,
					makeGap(
						sessionId,
						"constraint_omission",
						"medium",
						"Verification obligation may be omitted",
						"The response does not appear to acknowledge a known verification or migration obligation from the profile.",
						[obligation],
						[obligation, "tests", "verification"],
					),
				)
				break
			}
		}

		for (const styleRequirement of profile.styleRequirements.slice(0, 3)) {
			if (overlaps(response, styleRequirement).length === 0) {
				pushGapUnique(
					gaps,
					makeGap(
						sessionId,
						"constraint_omission",
						"medium",
						"Style or type requirement may be omitted",
						"The response does not appear to carry forward a stored style, typing, or format requirement that may matter to code quality.",
						[styleRequirement],
						[styleRequirement, "type safety", "style requirement"],
					),
				)
				break
			}
		}

		if ((profile.architectureDirection.length > 0 || profile.assumptions.length > 0) && suggestsBroadChange(responseLower)) {
			pushGapUnique(
				gaps,
				makeGap(
					sessionId,
					"architecture_drift",
					"high",
					"Possible architecture drift",
					"The response appears to suggest a broader architectural shift than the established direction or existing-state assumptions in the session profile.",
					[profile.architectureDirection[0] ?? profile.assumptions[0] ?? "", response],
					[...profile.architectureDirection, ...profile.assumptions].slice(0, 6),
				),
			)
		}

		const profileSignals = [
			...profile.constraints,
			...profile.architectureDirection,
			...profile.protectedAreas,
			...profile.protectedInterfaces,
			...profile.verificationObligations,
			...profile.styleRequirements,
		]
		const matchedProfileSignals = profileSignals.filter((signal) => overlaps(response, signal).length > 0)
		if (profileSignals.length > 0 && resolveCoverageQuality(matchedProfileSignals.length, Math.min(profileSignals.length, 4)) === "weak") {
			pushGapUnique(
				gaps,
				makeGap(
					sessionId,
					"temporal_drift",
					"medium",
					"Established context may be missing from the latest response",
					"The response reads as locally plausible, but it does not visibly anchor itself to the session's stored goals, constraints, protected areas, interfaces, or architecture direction.",
					[response],
					profileSignals.slice(0, 6),
				),
			)
		}

		if (profile.assumptions.length > 0 && suggestsBroadChange(responseLower) && profile.assumptions.every((assumption) => overlaps(response, assumption).length === 0)) {
			pushGapUnique(
				gaps,
				makeGap(
					sessionId,
					"temporal_drift",
					"medium",
					"Existing-state assumptions may be ignored",
					"The response appears to move as if the current implementation or inherited constraints do not matter, even though the stored profile says otherwise.",
					[profile.assumptions[0] ?? "", response],
					profile.assumptions.slice(0, 4),
				),
			)
		}
	}

	if (latestUserRequest) {
		const requestKeywords = keywordSet(latestUserRequest)
		const requestOverlapCount = requestKeywords.filter((token) => responseKeywords.has(token)).length
		if (requestKeywords.length >= 4 && resolveCoverageQuality(requestOverlapCount, Math.min(requestKeywords.length, 4)) === "weak") {
			pushGapUnique(
				gaps,
				makeGap(
					sessionId,
					"temporal_drift",
					"medium",
					"Requested change focus may be missing",
					"The response appears only weakly anchored to the user's most recent requested change, which increases the risk of session drift.",
					[latestUserRequest, response],
					requestKeywords.slice(0, 6),
				),
			)
		}
	}

	if (containsAny(responseLower, [/\byou'?re right\b/i, /\babsolutely\b/i, /\btotally\b/i, /\bsounds good\b/i, /\bof course\b/i])) {
		pushGapUnique(
			gaps,
			makeGap(
				sessionId,
				"sycophantic_drift",
				"low",
				"Possible sycophantic drift signal",
				"The response contains agreement-heavy language that can correlate with reduced adversarial checking in long sessions.",
				[response],
				["earlier constraints", "design direction"],
			),
		)
	}

	if (latestUserRequest) {
		for (const hidden of detectHiddenRequirements(latestUserRequest, response)) {
			if (hidden.coveredByResponse) continue
			pushGapUnique(
				gaps,
				makeGap(sessionId, "hidden_requirement_omission", "medium", `Missing follow-on requirement: ${hidden.requirement}`, hidden.rationale, [latestUserRequest, response], [hidden.requirement]),
			)
		}
	}

	return gaps
}

export function buildDriftPressure(
	sessionId: string,
	profile: StructuredProfile | null,
	latestResponse: string,
	latestUserRequest: string | undefined,
	gaps: BalloonGap[],
	hiddenRequirements: HiddenRequirement[],
): BalloonDriftPressure {
	const response = latestResponse.trim()
	const responseLower = response.toLowerCase()
	const responseKeywords = new Set(keywordSet(response))
	const requestKeywords = latestUserRequest ? keywordSet(latestUserRequest) : []
	const requestOverlapCount = requestKeywords.filter((token) => responseKeywords.has(token)).length
	const requestCoverage = latestUserRequest ? resolveCoverageQuality(requestOverlapCount, Math.min(requestKeywords.length, 4)) : "strong"
	const profileSignals = profile
		? uniq(
				[
					...profile.constraints,
					...profile.architectureDirection,
					...profile.protectedAreas,
					...profile.protectedInterfaces,
					...profile.verificationObligations,
					...profile.styleRequirements,
				],
				10,
			)
		: []
	const matchedProfileSignals = profileSignals.filter((signal) => overlaps(response, signal).length > 0)
	const profileAnchorCoverage = resolveCoverageQuality(matchedProfileSignals.length, Math.min(profileSignals.length, 4))
	const highSeverityGapCount = gaps.filter((gap) => gap.severity === "high").length
	const needsArchitectureRecovery = gaps.some((gap) => gap.type === "architecture_drift" || gap.type === "temporal_drift")
	const needsProtectedAreaRecovery = (profile?.protectedAreas.length ?? 0) > 0 && gaps.some((gap) => gap.type === "profile_contradiction")
	const needsInterfaceRecovery =
		(profile?.protectedInterfaces.length ?? 0) > 0 &&
		(gaps.some((gap) => gap.type === "profile_contradiction" && /interface|signature|schema|api|contract/i.test(`${gap.title} ${gap.description} ${gap.evidence.join(" ")}`)) ||
			suggestsInterfaceChange(responseLower))
	const needsVerificationRecovery =
		gaps.some((gap) => gap.type === "constraint_omission" && /verif|test|validation|migration|rollback|smoke|replayability|incident clarity/i.test(`${gap.title} ${gap.description} ${gap.evidence.join(" ")}`)) ||
		Boolean(profile?.verificationObligations.length && profile?.verificationObligations.every((obligation) => overlaps(response, obligation).length === 0))
	const styleRequirementText = profile?.styleRequirements.join(" ") ?? ""
	const needsStyleRecovery =
		Boolean(profile?.styleRequirements.length) &&
		(profile?.styleRequirements.every((requirement) => overlaps(response, requirement).length === 0) || /type safety/i.test(styleRequirementText) && !/type safety/i.test(response))
	const needsHiddenRequirementRecovery = hiddenRequirements.some((requirement) => !requirement.coveredByResponse)
	const dominantGapTypes = Array.from(
		gaps.reduce((counts, gap) => {
			const weight = gap.severity === "high" ? 3 : gap.severity === "medium" ? 2 : 1
			counts.set(gap.type, (counts.get(gap.type) ?? 0) + weight)
			return counts
		}, new Map<BalloonGapType, number>()),
	)
		.sort((left, right) => right[1] - left[1])
		.map(([type]) => type)
		.slice(0, 3)

	let score = gaps.reduce((sum, gap) => sum + (gap.severity === "high" ? 18 : gap.severity === "medium" ? 10 : 4), 0)
	score += requestCoverage === "weak" ? 14 : requestCoverage === "partial" ? 6 : 0
	score += profileAnchorCoverage === "weak" ? 12 : profileAnchorCoverage === "partial" ? 5 : 0
	if (needsProtectedAreaRecovery) score += 10
	if (needsInterfaceRecovery) score += 8
	if (needsVerificationRecovery) score += 8
	if (needsStyleRecovery) score += 5
	if (needsHiddenRequirementRecovery) score += 6
	score = Math.min(100, score)

	const level =
		score >= 70 ? "critical" : score >= 40 ? "high" : score >= 18 ? "guarded" : "low"

	const reasons = uniq(
		[
			...(highSeverityGapCount > 0 ? [`${highSeverityGapCount} high-severity gap(s) are active.`] : []),
			...(requestCoverage === "weak"
				? ["The latest response only weakly overlaps the user's requested change."]
				: requestCoverage === "partial"
					? ["The latest response only partially overlaps the user's requested change."]
					: []),
			...(profileAnchorCoverage === "weak"
				? ["Stored profile anchors are largely missing from the latest response."]
				: profileAnchorCoverage === "partial"
					? ["Stored profile anchors are only partially visible in the latest response."]
					: []),
			...(needsProtectedAreaRecovery ? ["Protected areas need explicit recovery pressure."] : []),
			...(needsInterfaceRecovery ? ["Protected interfaces or contracts need explicit preservation."] : []),
			...(needsVerificationRecovery ? ["Verification obligations need to stay explicit in the next turn."] : []),
			...(needsStyleRecovery ? ["Type or style requirements are fading from the reply path."] : []),
			...(needsHiddenRequirementRecovery ? ["Missing follow-on requirements still need recovery."] : []),
			...(needsArchitectureRecovery && suggestsBroadChange(responseLower) ? ["Broad rewrite pressure is still visible in the latest response."] : []),
		],
		6,
	)

	return {
		sessionId,
		score,
		level,
		gapCount: gaps.length,
		highSeverityGapCount,
		dominantGapTypes,
		requestCoverage,
		profileAnchorCoverage,
		needsArchitectureRecovery,
		needsVerificationRecovery,
		needsProtectedAreaRecovery,
		needsInterfaceRecovery,
		needsStyleRecovery,
		needsHiddenRequirementRecovery,
		reasons,
	}
}

export function createDriftPressureSnapshot(input: {
	sessionId: string
	source: BalloonDriftPressureSource
	turnCount: number
	requestText?: string | null
	latestResponse?: string | null
	recordedAt?: string
	pressure: BalloonDriftPressure
}): BalloonDriftPressureSnapshot {
	return {
		snapshotId: makeId("pressure"),
		sessionId: input.sessionId,
		source: input.source,
		turnCount: Math.max(0, Math.floor(input.turnCount)),
		requestText: input.requestText ?? null,
		latestResponse: input.latestResponse ?? null,
		recordedAt: input.recordedAt ?? nowIso(),
		pressure: input.pressure,
	}
}

export function summarizeDriftPressureHistory(sessionId: string, snapshots: BalloonDriftPressureSnapshot[]): BalloonDriftPressureHistorySummary {
	const ordered = [...snapshots].sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
	const recentSnapshots = ordered.slice(0, 8)
	const scores = ordered.map((snapshot) => snapshot.pressure.score)
	const latest = ordered[0] ?? null
	const oldest = ordered[ordered.length - 1] ?? null
	const peakScore = scores.length > 0 ? Math.max(...scores) : null
	const averageScore = scores.length > 0 ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10 : null
	let trend: BalloonDriftPressureHistorySummary["trend"] = "insufficient_data"
	if (ordered.length >= 2 && latest && oldest) {
		const delta = latest.pressure.score - oldest.pressure.score
		const spread = Math.max(...scores) - Math.min(...scores)
		if (Math.abs(delta) <= 6 && spread <= 12) trend = "stable"
		else if (delta >= 8) trend = "rising"
		else if (delta <= -8) trend = "falling"
		else trend = "mixed"
	}

	const reasons = uniq(
		[
			...(latest ? [`Latest pressure is ${latest.pressure.level} at ${latest.pressure.score}/100.`] : []),
			...(trend === "rising" ? ["Recent drift pressure is increasing instead of settling."] : []),
			...(trend === "falling" ? ["Recent drift pressure is decreasing, which suggests the correction path is helping."] : []),
			...(trend === "stable" && latest ? ["Recent drift pressure is relatively stable across the latest snapshots."] : []),
			...(trend === "mixed" ? ["Recent drift pressure is oscillating rather than moving in one clean direction."] : []),
			...(peakScore !== null && peakScore >= 70 ? [`Peak recorded drift pressure reached ${peakScore}/100.`] : []),
		],
		6,
	)

	return {
		sessionId,
		totalSnapshots: ordered.length,
		latestScore: latest?.pressure.score ?? null,
		latestLevel: latest?.pressure.level ?? null,
		peakScore,
		averageScore,
		trend,
		reasons,
		recentSnapshots,
	}
}

function focusPriority(focus: BalloonPersistentDriftFocus): number {
	switch (focus) {
		case "architecture":
			return 1
		case "verification":
			return 2
		case "protected_area":
			return 3
		case "interface":
			return 4
		case "style":
			return 5
		case "hidden_requirement":
			return 6
		case "request_reanchor":
		default:
			return 7
	}
}

function focusBoosts(focus: BalloonPersistentDriftFocus, profile: StructuredProfile | null, hiddenRequirements: HiddenRequirement[]): string[] {
	switch (focus) {
		case "architecture":
			return [...(profile?.architectureDirection ?? []), ...(profile?.constraints ?? []).filter((value) => inferArchitectureDirection(value)), "existing architecture", "current structure"]
		case "verification":
			return [...(profile?.verificationObligations ?? []), "tests", "verification", "validation", "smoke", "migration", "rollback", "replayability"]
		case "protected_area":
			return [...(profile?.protectedAreas ?? []), "protected files", "excluded areas", "do not modify"]
		case "interface":
			return [...(profile?.protectedInterfaces ?? []), "interface", "contract", "schema", "api", "signature"]
		case "style":
			return [...(profile?.styleRequirements ?? []), "type safety", "strict typing", "style requirements"]
		case "hidden_requirement":
			return [...hiddenRequirements.map((requirement) => requirement.requirement), "follow-on requirement", "implied work"]
		case "request_reanchor":
		default:
			return [...(profile?.goals ?? []), ...(profile?.constraints ?? []), "user request", "session context"]
	}
}

function focusReasonLabel(focus: BalloonPersistentDriftFocus): string {
	switch (focus) {
		case "architecture":
			return "persistent architecture drift"
		case "verification":
			return "persistent verification drift"
		case "protected_area":
			return "persistent protected-area drift"
		case "interface":
			return "persistent interface drift"
		case "style":
			return "persistent style/type drift"
		case "hidden_requirement":
			return "persistent follow-on drift"
		case "request_reanchor":
		default:
			return "persistent request re-anchor pressure"
	}
}

function focusInstruction(focus: BalloonPersistentDriftFocus): string {
	switch (focus) {
		case "architecture":
			return "Repeated architecture drift: preserve the established architecture direction before proposing larger shifts."
		case "verification":
			return "Repeated verification omission: keep tests, validation, and migration obligations explicit."
		case "protected_area":
			return "Repeated protected-area drift: keep protected files and excluded areas unchanged unless the user explicitly reopens them."
		case "interface":
			return "Repeated interface drift: preserve existing interfaces and contracts unless the user explicitly requests a change."
		case "style":
			return "Repeated style/type drift: keep type safety and style requirements visible in the next turn."
		case "hidden_requirement":
			return "Repeated follow-on drift: carry forward the next implied requirement before adding polish."
		case "request_reanchor":
		default:
			return "Repeated session drift: re-anchor the next turn to the active request and stored session context."
	}
}

function resolveGapFocus(gap: BalloonGap): BalloonPersistentDriftFocus {
	if (gap.type === "architecture_drift") return "architecture"
	if (gap.type === "temporal_drift" || gap.type === "sycophantic_drift") return "request_reanchor"
	if (gap.type === "hidden_requirement_omission") return "hidden_requirement"
	if (gap.type === "constraint_omission") {
		return /verif|test|validation|migration|rollback|smoke|replayability|incident clarity/i.test(`${gap.title} ${gap.description} ${gap.evidence.join(" ")}`)
			? "verification"
			: "request_reanchor"
	}
	if (gap.type === "profile_contradiction") {
		return /interface|signature|schema|api|contract/i.test(`${gap.title} ${gap.description} ${gap.evidence.join(" ")}`) ? "interface" : "protected_area"
	}
	return "request_reanchor"
}

export function buildPersistentDriftBias(input: {
	sessionId: string
	profile: StructuredProfile | null
	gaps: BalloonGap[]
	recentGaps: BalloonGap[]
	hiddenRequirements: HiddenRequirement[]
	driftPressure: BalloonDriftPressure
	pressureHistory: BalloonDriftPressureHistorySummary
}): BalloonPersistentDriftBias {
	const focusWeights = new Map<BalloonPersistentDriftFocus, number>()
	const queryBoosts: string[] = []
	const reasons: string[] = []
	const combinedGaps = [...input.gaps, ...input.recentGaps.filter((gap) => !input.gaps.some((current) => current.gapId === gap.gapId))]
	const repeatedTypeWeights = combinedGaps.reduce((counts, gap) => {
		const weight = (input.gaps.some((current) => current.gapId === gap.gapId) ? 2 : 1) + (gap.severity === "high" ? 2 : gap.severity === "medium" ? 1 : 0)
		counts.set(gap.type, (counts.get(gap.type) ?? 0) + weight)
		return counts
	}, new Map<BalloonGapType, number>())
	const repeatedGapTypes = Array.from(repeatedTypeWeights.entries())
		.filter(([, weight]) => weight >= 3)
		.sort((left, right) => right[1] - left[1])
		.map(([type]) => type)
		.slice(0, 4)
	const sustainedPressure =
		(input.pressureHistory.latestScore ?? 0) >= 55 ||
		(input.pressureHistory.averageScore ?? 0) >= 45 ||
		input.pressureHistory.trend === "rising" ||
		(input.pressureHistory.totalSnapshots >= 4 && (input.pressureHistory.latestLevel === "high" || input.pressureHistory.latestLevel === "critical"))
	const addFocus = (focus: BalloonPersistentDriftFocus, weight: number, reason: string): void => {
		focusWeights.set(focus, (focusWeights.get(focus) ?? 0) + weight)
		queryBoosts.push(...focusBoosts(focus, input.profile, input.hiddenRequirements))
		reasons.push(reason)
	}

	for (const gap of input.gaps) {
		addFocus(resolveGapFocus(gap), gap.severity === "high" ? 3 : gap.severity === "medium" ? 2 : 1, `${focusReasonLabel(resolveGapFocus(gap))} is active in the latest turn.`)
	}
	for (const [gapType, weight] of repeatedTypeWeights.entries()) {
		if (weight < 3) continue
		addFocus(resolveGapFocus({ ...(combinedGaps.find((gap) => gap.type === gapType) ?? input.gaps[0] ?? input.recentGaps[0]!), type: gapType }), 1, `${gapType.replace(/_/g, " ")} has repeated across recent Balloon audits.`)
	}
	if (input.driftPressure.needsArchitectureRecovery) addFocus("architecture", 2, "Architecture recovery is still required.")
	if (input.driftPressure.needsVerificationRecovery) addFocus("verification", 2, "Verification obligations are still fading from the reply path.")
	if (input.driftPressure.needsProtectedAreaRecovery) addFocus("protected_area", 2, "Protected areas still need explicit recovery pressure.")
	if (input.driftPressure.needsInterfaceRecovery) addFocus("interface", 2, "Interface preservation still needs to stay explicit.")
	if (input.driftPressure.needsStyleRecovery) addFocus("style", 1, "Style and type constraints still need reinforcement.")
	if (input.driftPressure.needsHiddenRequirementRecovery || input.hiddenRequirements.some((requirement) => !requirement.coveredByResponse)) {
		addFocus("hidden_requirement", 1, "Follow-on requirements are still being missed.")
	}
	if (input.driftPressure.requestCoverage !== "strong" || input.driftPressure.profileAnchorCoverage !== "strong") {
		addFocus("request_reanchor", 1, "The latest reply path needs stronger request re-anchoring.")
	}
	if (sustainedPressure) {
		const strongestFocus = Array.from(focusWeights.entries()).sort((left, right) => right[1] - left[1])[0]?.[0]
		if (strongestFocus) focusWeights.set(strongestFocus, (focusWeights.get(strongestFocus) ?? 0) + 1)
		reasons.push("Pressure history shows sustained or rising drift, so repeated failures should be prioritized earlier.")
	}

	const focusOrder = Array.from(focusWeights.entries())
		.sort((left, right) => right[1] - left[1] || focusPriority(left[0]) - focusPriority(right[0]))
		.map(([focus]) => focus)
		.slice(0, 5)

	return {
		sessionId: input.sessionId,
		focusOrder,
		sustainedPressure,
		repeatedGapTypes,
		queryBoosts: uniq(queryBoosts, 12),
		reasons: uniq(reasons, 6),
	}
}

export function retrieveRelevantTurns(
	turns: BalloonTurn[],
	gapQueries: string[],
	limit = 5,
	options?: {
		bias?: BalloonPersistentDriftBias
	},
): RetrievalHit[] {
	const queries = uniq(gapQueries.flatMap((query) => keywordSet(query)), 24)
	if (queries.length === 0) return []
	const hits: RetrievalHit[] = []
	for (const turn of turns) {
		const reasons: string[] = []
		const biasReasons: string[] = []
		const contentTokens = new Set(keywordSet(turn.content))
		for (const query of queries) {
			if (contentTokens.has(query)) reasons.push(query)
		}
		if (options?.bias) {
			for (const focus of options.bias.focusOrder) {
				const focusTokens = keywordSet(focusBoosts(focus, null, []).join(" "))
				if (focusTokens.some((token) => contentTokens.has(token))) biasReasons.push(focusReasonLabel(focus))
			}
		}
		if (reasons.length === 0 && biasReasons.length === 0) continue
		const score = reasons.length + biasReasons.length * 0.75 + (turn.role === "user" && biasReasons.length > 0 ? 0.25 : 0)
		hits.push({
			turnId: turn.turnId,
			role: turn.role,
			content: turn.content,
			score: Number(score.toFixed(2)),
			reasons: uniq(reasons, 8),
			biasReasons: uniq(biasReasons, 4),
		})
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function buildProxyTrickle(sessionId: string, gaps: BalloonGap[], hits: RetrievalHit[], bias?: BalloonPersistentDriftBias): ProxyTrickle {
	const gapPriority = new Map<BalloonPersistentDriftFocus, number>((bias?.focusOrder ?? []).map((focus, index) => [focus, index]))
	const orderedGaps = [...gaps].sort((left, right) => {
		const leftFocus = gapPriority.get(resolveGapFocus(left)) ?? 99
		const rightFocus = gapPriority.get(resolveGapFocus(right)) ?? 99
		if (leftFocus !== rightFocus) return leftFocus - rightFocus
		const severityWeight = (gap: BalloonGap): number => (gap.severity === "high" ? 0 : gap.severity === "medium" ? 1 : 2)
		return severityWeight(left) - severityWeight(right)
	})
	const persistentInstructions = (bias?.focusOrder ?? []).slice(0, 3).map((focus) => focusInstruction(focus))
	const priorityInstructions = uniq(
		[
			...persistentInstructions,
			...orderedGaps.map((gap) => {
				switch (gap.type) {
					case "profile_contradiction":
						return `Do not violate protected or excluded areas: ${gap.title}`
					case "constraint_omission":
						return `Re-anchor the next turn to the missing constraint: ${gap.title}`
					case "temporal_drift":
						return "Reconnect the next turn to established session context."
					case "sycophantic_drift":
						return "Favor adversarial checking over agreement-heavy phrasing."
					case "architecture_drift":
						return "Preserve the established architecture direction before proposing larger shifts."
					case "hidden_requirement_omission":
						return `Include follow-on requirement: ${gap.suggestedQueries[0] ?? gap.title}`
				}
			}),
		],
		6,
	)

	const retrievalAnchors = uniq(hits.map((hit) => `${hit.role}: ${hit.content}`).slice(0, 4), 4)
	const provenance = uniq([...gaps.map((gap) => gap.gapId), ...hits.map((hit) => hit.turnId)])
	const summary =
		priorityInstructions.length > 0
			? `Proxy trickle generated from ${gaps.length} gap(s) with ${hits.length} retrieval anchor(s).${bias?.focusOrder.length ? ` Persistent pressure prioritized ${bias.focusOrder.join(", ")}.` : ""}`
			: "No strong corrective pressure identified; proxy trickle remains light."
	const deliveryText =
		priorityInstructions.length > 0
			? [
					"Balloon proxy trickle:",
					...(bias?.focusOrder.length ? [`Persistent pressure: ${bias.focusOrder.join(", ")}`] : []),
					...priorityInstructions.map((instruction, index) => `${index + 1}. ${instruction}`),
					...(retrievalAnchors.length > 0 ? ["Relevant prior context:", ...retrievalAnchors.map((anchor) => `- ${anchor}`)] : []),
			  ].join("\n")
			: "Balloon proxy trickle: keep the next turn aligned to stored goals, constraints, and prior architecture decisions."

	return {
		trickleId: makeId("trickle"),
		sessionId,
		summary,
		persistentFocus: bias?.focusOrder ?? [],
		priorityInstructions,
		retrievalAnchors,
		provenance,
		deliveryText,
		createdAt: nowIso(),
	}
}

export function summarizeMemoryPromotion(items: MemoryLedgerItem[]): string[] {
	return items.map((item) => `${item.itemText} (count=${item.count}, status=${item.status})`)
}
