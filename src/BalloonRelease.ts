import crypto from "crypto"
import type { MemoryLedgerItem, ProxyTrickle, ReleasePacket, ReleasedCorrection } from "./types"

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
	"next",
	"turn",
	"reply",
	"step",
	"stored",
	"explicit",
	"forward",
	"carry",
	"requested",
	"change",
])

function keywordSet(text: string): string[] {
	return uniq(
		text
			.toLowerCase()
			.replace(/[^a-z0-9_./-]+/g, " ")
			.split(/\s+/g)
			.filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
		24,
	)
}

function computeSimilarity(queryText: string, candidateText: string): { score: number; matchedTerms: string[] } {
	const queryTerms = keywordSet(queryText)
	const candidateTerms = keywordSet(candidateText)
	if (queryTerms.length === 0 || candidateTerms.length === 0) {
		return { score: 0, matchedTerms: [] }
	}

	const querySet = new Set(queryTerms)
	const matchedTerms = candidateTerms.filter((term) => querySet.has(term))
	if (matchedTerms.length === 0) {
		return { score: 0, matchedTerms: [] }
	}

	const queryCoverage = matchedTerms.length / Math.max(queryTerms.length, 1)
	const candidateCoverage = matchedTerms.length / Math.max(candidateTerms.length, 1)
	const rawScore = queryCoverage * 0.65 + candidateCoverage * 0.35
	return {
		score: Number(rawScore.toFixed(3)),
		matchedTerms: uniq(matchedTerms, 8),
	}
}

function memoryThreshold(status: MemoryLedgerItem["status"]): number {
	switch (status) {
		case "solidified":
			return 0.14
		case "reinforced":
			return 0.2
		case "observed":
		default:
			return 0.28
	}
}

function trickleThreshold(sourceText: string): number {
	if (/include follow-on requirement/i.test(sourceText)) return 0.18
	if (/re-anchor the next turn/i.test(sourceText)) return 0.18
	return 0.24
}

function buildReleaseSummary(packet: ReleasePacket): string {
	return `Similarity-gated release evaluated ${packet.released.length + packet.held.length} candidate correction(s): released ${packet.released.length}, held ${packet.held.length}.`
}

function buildReleaseDeliveryText(packet: ReleasePacket): string {
	if (packet.released.length === 0) {
		return "No similarity-gated corrections were strong enough to release into the next Balloon step."
	}
	const lines = [
		"Similarity-gated release:",
		...packet.released.slice(0, 6).map((item, index) => `${index + 1}. ${item.sourceText} (score=${item.similarityScore.toFixed(2)}, matched=${item.matchedTerms.join(", ") || "none"})`),
	]
	return lines.join("\n")
}

type ReleasePacketOptions = {
	queryText: string
	recentTrickles: ProxyTrickle[]
	memoryItems: MemoryLedgerItem[]
}

export function buildReleasePacket(sessionId: string, options: ReleasePacketOptions): ReleasePacket {
	const released: ReleasedCorrection[] = []
	const held: ReleasedCorrection[] = []
	const createdAt = nowIso()

	for (const item of options.memoryItems) {
		const similarity = computeSimilarity(options.queryText, item.itemText)
		const threshold = memoryThreshold(item.status)
		const entry: ReleasedCorrection = {
			releaseId: makeId("release"),
			sessionId,
			sourceKind: "memory",
			sourceId: item.itemKey,
			sourceText: item.itemText,
			similarityScore: similarity.score,
			threshold,
			matchedTerms: similarity.matchedTerms,
			released: similarity.score >= threshold,
			status: item.status,
			createdAt,
		}
		if (entry.released) released.push(entry)
		else held.push(entry)
	}

	for (const trickle of options.recentTrickles) {
		trickle.priorityInstructions.forEach((instruction, index) => {
			const similarity = computeSimilarity(options.queryText, instruction)
			const threshold = trickleThreshold(instruction)
			const entry: ReleasedCorrection = {
				releaseId: makeId("release"),
				sessionId,
				sourceKind: "trickle",
				sourceId: `${trickle.trickleId}:${index + 1}`,
				sourceText: instruction,
				similarityScore: similarity.score,
				threshold,
				matchedTerms: similarity.matchedTerms,
				released: similarity.score >= threshold,
				createdAt,
			}
			if (entry.released) released.push(entry)
			else held.push(entry)
		})
	}

	released.sort((left, right) => right.similarityScore - left.similarityScore)
	held.sort((left, right) => right.similarityScore - left.similarityScore)

	const packet: ReleasePacket = {
		packetId: makeId("packet"),
		sessionId,
		queryText: options.queryText,
		released,
		held,
		summary: "",
		deliveryText: "",
		createdAt,
	}
	packet.summary = buildReleaseSummary(packet)
	packet.deliveryText = buildReleaseDeliveryText(packet)
	return packet
}

function cleanReleaseText(value: string): string {
	return value.trim().replace(/\s+/g, " ").replace(/[.]+$/u, "")
}

export function extractReleasedGuidance(packet: ReleasePacket, limit = 4): string[] {
	const guidance: string[] = []
	for (const released of packet.released) {
		let text = cleanReleaseText(released.sourceText)
		if (!text) continue
		text = text
			.replace(/^Re-anchor the next turn to the missing constraint:\s*/iu, "")
			.replace(/^Include follow-on requirement:\s*/iu, "")
			.replace(/^Do not violate protected or excluded areas:\s*/iu, "")
			.trim()
		if (!text) continue
		if (/verification obligation may be omitted/iu.test(text)) continue
		if (/possible architecture drift/iu.test(text)) continue
		if (/protected area may be contradicted/iu.test(text)) continue
		if (/possible sycophantic drift signal/iu.test(text)) continue
		if (/established context may be missing from the latest response/iu.test(text)) continue
		if (/favor adversarial checking/i.test(text)) continue
		if (/preserve the established architecture direction/i.test(text)) continue
		if (/reconnect the next turn to established session context/i.test(text)) continue
		guidance.push(text)
		if (guidance.length >= limit) break
	}
	return uniq(guidance, limit)
}
