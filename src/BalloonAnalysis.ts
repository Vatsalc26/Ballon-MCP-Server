import crypto from "crypto"
import type { BalloonGap, BalloonGapSeverity, BalloonGapType, BalloonTurn, HiddenRequirement, MemoryLedgerItem, ProxyTrickle, RetrievalHit, StructuredProfile } from "./types"

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

	if (profile) {
		for (const protectedArea of profile.protectedAreas) {
			const matched = overlaps(response, protectedArea)
			if (matched.length > 0 && containsAny(responseLower, [/\bedit\b/i, /\bmodify\b/i, /\bchange\b/i, /\bremove\b/i, /\brewrite\b/i, /\bdelete\b/i])) {
				gaps.push(makeGap(sessionId, "profile_contradiction", "high", "Protected area may be contradicted", "The latest response appears to propose modifying an area that profile context marked as protected or excluded.", [protectedArea, response], [protectedArea]))
				break
			}
		}

		for (const obligation of profile.verificationObligations.slice(0, 4)) {
			if (overlaps(response, obligation).length === 0) {
				gaps.push(makeGap(sessionId, "constraint_omission", "medium", "Verification obligation may be omitted", "The response does not appear to acknowledge a known verification or migration obligation from the profile.", [obligation], [obligation, "tests", "verification"]))
				break
			}
		}

		if (profile.architectureDirection.length > 0 && containsAny(responseLower, [/\brewrite\b/i, /\bfrom scratch\b/i, /\bnew framework\b/i, /\bswap\b/i, /\breplace entirely\b/i])) {
			gaps.push(makeGap(sessionId, "architecture_drift", "high", "Possible architecture drift", "The response appears to suggest a broader architectural shift than the established direction in the session profile.", [profile.architectureDirection[0] ?? "", response], profile.architectureDirection))
		}

		const profileSignals = [...profile.constraints, ...profile.architectureDirection, ...profile.protectedAreas, ...profile.verificationObligations]
		const anyProfileOverlap = profileSignals.some((signal) => overlaps(response, signal).length > 0)
		if (profileSignals.length > 0 && !anyProfileOverlap) {
			gaps.push(makeGap(sessionId, "temporal_drift", "medium", "Established context may be missing from the latest response", "The response reads as locally plausible, but it does not visibly anchor itself to the session's stored goals, constraints, or architecture direction.", [response], profileSignals.slice(0, 4)))
		}
	}

	if (containsAny(responseLower, [/\byou'?re right\b/i, /\babsolutely\b/i, /\btotally\b/i, /\bsounds good\b/i, /\bof course\b/i])) {
		gaps.push(makeGap(sessionId, "sycophantic_drift", "low", "Possible sycophantic drift signal", "The response contains agreement-heavy language that can correlate with reduced adversarial checking in long sessions.", [response], ["earlier constraints", "design direction"]))
	}

	if (latestUserRequest) {
		for (const hidden of detectHiddenRequirements(latestUserRequest, response)) {
			if (hidden.coveredByResponse) continue
			gaps.push(makeGap(sessionId, "hidden_requirement_omission", "medium", `Missing follow-on requirement: ${hidden.requirement}`, hidden.rationale, [latestUserRequest, response], [hidden.requirement]))
		}
	}

	return gaps
}

export function retrieveRelevantTurns(turns: BalloonTurn[], gapQueries: string[], limit = 5): RetrievalHit[] {
	const queries = uniq(gapQueries.flatMap((query) => keywordSet(query)), 24)
	if (queries.length === 0) return []
	const hits: RetrievalHit[] = []
	for (const turn of turns) {
		const reasons: string[] = []
		const contentTokens = new Set(keywordSet(turn.content))
		for (const query of queries) {
			if (contentTokens.has(query)) reasons.push(query)
		}
		if (reasons.length === 0) continue
		hits.push({
			turnId: turn.turnId,
			role: turn.role,
			content: turn.content,
			score: reasons.length,
			reasons: uniq(reasons, 8),
		})
	}
	return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}

export function buildProxyTrickle(sessionId: string, gaps: BalloonGap[], hits: RetrievalHit[]): ProxyTrickle {
	const priorityInstructions = uniq(
		gaps.map((gap) => {
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
		6,
	)

	const retrievalAnchors = uniq(hits.map((hit) => `${hit.role}: ${hit.content}`).slice(0, 4), 4)
	const provenance = uniq([...gaps.map((gap) => gap.gapId), ...hits.map((hit) => hit.turnId)])
	const summary =
		priorityInstructions.length > 0
			? `Proxy trickle generated from ${gaps.length} gap(s) with ${hits.length} retrieval anchor(s).`
			: "No strong corrective pressure identified; proxy trickle remains light."
	const deliveryText =
		priorityInstructions.length > 0
			? [
					"Balloon proxy trickle:",
					...priorityInstructions.map((instruction, index) => `${index + 1}. ${instruction}`),
					...(retrievalAnchors.length > 0 ? ["Relevant prior context:", ...retrievalAnchors.map((anchor) => `- ${anchor}`)] : []),
			  ].join("\n")
			: "Balloon proxy trickle: keep the next turn aligned to stored goals, constraints, and prior architecture decisions."

	return {
		trickleId: makeId("trickle"),
		sessionId,
		summary,
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
