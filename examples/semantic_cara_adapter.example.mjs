import process from "node:process"

function asString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function uniq(values, limit = 6) {
	const seen = new Set()
	const out = []
	for (const value of values) {
		const normalized = asString(value)?.replace(/\s+/g, " ") ?? null
		if (!normalized) continue
		const key = normalized.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(normalized)
		if (out.length >= limit) break
	}
	return out
}

function cleanSentence(value) {
	return value.trim().replace(/\s+/g, " ").replace(/[.]+$/u, "")
}

function stripRequestPrefix(text) {
	return text
		.replace(/^(please|kindly)\s+/iu, "")
		.replace(/^(i want to|i need to|we need to|we want to|can you|could you|help me)\s+/iu, "")
		.trim()
}

function extractTarget(requestText) {
	const firstSentence = requestText.split(/(?<=[.!?])\s+/u)[0] ?? requestText
	const stripped = stripRequestPrefix(firstSentence)
	const withoutClause = stripped.split(/\bwithout\b/iu)[0]?.trim() ?? stripped
	return cleanSentence(withoutClause)
}

function joinPhraseList(values) {
	if (values.length === 0) return ""
	if (values.length === 1) return values[0] ?? ""
	if (values.length === 2) return `${values[0]} and ${values[1]}`
	return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`
}

function joinActionClauses(values) {
	if (values.length === 0) return ""
	if (values.length === 1) return values[0] ?? ""
	return `${values.slice(0, -1).join("; ")}; and ${values[values.length - 1]}`
}

function collectVerificationItems(values) {
	const flags = {
		tests: false,
		typeSafety: false,
		incidentClarity: false,
		replayability: false,
	}
	const extras = []
	for (const value of values) {
		const cleaned = cleanSentence(value)
		if (!cleaned) continue
		let matched = false
		if (/type safety/iu.test(cleaned)) {
			flags.typeSafety = true
			matched = true
		}
		if (/incident clarity/iu.test(cleaned)) {
			flags.incidentClarity = true
			matched = true
		}
		if (/replayability/iu.test(cleaned)) {
			flags.replayability = true
			matched = true
		}
		if (/\btests?\b/iu.test(cleaned) || /verification obligation/iu.test(cleaned)) {
			flags.tests = true
			matched = true
		}
		if (!matched) extras.push(cleaned)
	}

	const normalized = []
	if (flags.typeSafety) normalized.push("type safety")
	if (flags.tests) {
		if (flags.incidentClarity || flags.replayability) normalized.push("tests")
		else normalized.push("tests for the affected change")
	}
	if (flags.incidentClarity) normalized.push("incident clarity")
	if (flags.replayability) normalized.push("replayability")
	return uniq([...normalized, ...extras], 6)
}

function extractStanceValue(nextTurnStance, prefix) {
	const match = nextTurnStance.find((value) => typeof value === "string" && value.startsWith(prefix))
	return match ? cleanSentence(match.slice(prefix.length)) : null
}

function normalizeDirection(value) {
	const cleaned = cleanSentence(value)
	if (!cleaned) return "the existing architecture"
	if (/^do not rewrite architecture/iu.test(cleaned)) return "the current architecture"
	if (/^preserve existing architecture/iu.test(cleaned)) return "the existing architecture"
	if (/^preserve the current .+ flow/iu.test(cleaned)) return cleaned.replace(/^preserve\s+/iu, "").trim()
	if (/^preserve the existing .+/iu.test(cleaned)) return cleaned.replace(/^preserve\s+/iu, "").trim()
	if (/^preserve .+/iu.test(cleaned)) return cleaned.replace(/^preserve\s+/iu, "").trim()
	return cleaned
}

function extractProtectedPath(protectedAreas) {
	for (const entry of protectedAreas) {
		if (typeof entry !== "string") continue
		const pathMatch = /\b(?:src|app|lib|tests?|docs|scripts)\/[A-Za-z0-9_./-]+/u.exec(entry)
		if (pathMatch) return pathMatch[0]?.replace(/[.,;:]+$/u, "") ?? null
	}
	return null
}

function extractDirectionFromDeterministicReply(text) {
	const match = /^I would preserve (.+?) and keep this change bounded\./iu.exec(asString(text) ?? "")
	return match ? cleanSentence(match[1]) : null
}

const chunks = []
for await (const chunk of process.stdin) {
	chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
}

const raw = Buffer.concat(chunks).toString("utf8").trim()
const packet = raw.length > 0 ? JSON.parse(raw) : {}

const requestText = typeof packet.requestText === "string" ? packet.requestText : "the requested change"
const nextTurnStance = Array.isArray(packet.nextTurnStance) ? packet.nextTurnStance.filter((value) => typeof value === "string") : []
const deterministicReply = asString(packet.deterministicReply)
const profile = packet.profile && typeof packet.profile === "object" ? packet.profile : {}
const protectedAreas = Array.isArray(profile.protectedAreas) ? profile.protectedAreas.filter((value) => typeof value === "string") : []
const verificationObligations = Array.isArray(profile.verificationObligations)
	? profile.verificationObligations.filter((value) => typeof value === "string")
	: []
const hiddenRequirements = Array.isArray(packet.hiddenRequirements)
	? packet.hiddenRequirements.flatMap((value) => (value && typeof value === "object" && typeof value.requirement === "string" ? [value.requirement] : []))
	: []
const direction = normalizeDirection(
	extractDirectionFromDeterministicReply(deterministicReply) ??
	extractStanceValue(nextTurnStance, "Preserve direction: ") ??
	(Array.isArray(profile.architectureDirection) ? profile.architectureDirection.find((value) => typeof value === "string" && !/^protected files?:/iu.test(value)) : null) ??
	"the existing architecture",
)
const protectedPath = extractProtectedPath(protectedAreas)
const target = extractTarget(requestText)
const verificationItems = collectVerificationItems([
	...verificationObligations,
	...(Array.isArray(profile.constraints)
		? profile.constraints.filter((value) => typeof value === "string" && /type safety|tests?|incident clarity|replayability/iu.test(value))
		: []),
])
const followOnItems = uniq(hiddenRequirements.map((value) => cleanSentence(value)))
const nextStepClauses = [
	target ? `make only this bounded change: ${target}` : null,
	verificationItems.length > 0 ? `keep ${joinPhraseList(verificationItems)} explicit` : null,
	followOnItems.length > 0 ? `account for ${joinPhraseList(followOnItems.slice(0, 3))}` : null,
	`leave ${protectedPath ?? "the broader architecture"} alone`,
].filter(Boolean)

const rewrittenReply = [
	`I would preserve ${direction} and keep this change bounded.`,
	`I would focus directly on the requested change: ${target}, instead of starting with a broader refactor.`,
	...(protectedPath ? [`I would avoid changing ${protectedPath} while making that improvement.`] : []),
	...(verificationItems.length > 0 ? [`I would keep ${joinPhraseList(verificationItems)} explicit in the next step.`] : []),
	...(followOnItems.length > 0 ? [`I would also account for ${joinPhraseList(followOnItems)}.`] : []),
	...(nextStepClauses.length > 0 ? [`The smallest safe next step is to ${joinActionClauses(nextStepClauses)}.`] : []),
].join(" ")

const response = {
	notes: [
		"Make the repair reply sound like a disciplined teammate, not a stitched-together rule dump.",
		"Keep protected areas, architecture wording, verification obligations, and bounded next-step quality explicit in natural language.",
		"Prefer the smallest safe next step over widening scope early.",
	],
	suggestedAdditions: uniq([...hiddenRequirements.slice(0, 2), ...nextTurnStance.slice(0, 2), ...verificationItems.slice(0, 2)], 6),
	rewrittenReply,
	correctionSummaryAddendum: "Semantic CARA preserved the protected areas, architecture wording, verification obligations, and bounded next-step quality while refining the repaired phrasing.",
}

process.stdout.write(`${JSON.stringify(response)}\n`)
