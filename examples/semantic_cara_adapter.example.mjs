import process from "node:process"

const chunks = []
for await (const chunk of process.stdin) {
	chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
}

const raw = Buffer.concat(chunks).toString("utf8").trim()
const packet = raw.length > 0 ? JSON.parse(raw) : {}

const requestText = typeof packet.requestText === "string" ? packet.requestText : "the requested change"
const nextTurnStance = Array.isArray(packet.nextTurnStance) ? packet.nextTurnStance.filter((value) => typeof value === "string") : []
const hiddenRequirements = Array.isArray(packet.hiddenRequirements)
	? packet.hiddenRequirements.flatMap((value) => (value && typeof value === "object" && typeof value.requirement === "string" ? [value.requirement] : []))
	: []

const response = {
	notes: [
		"Make the repair reply sound like a disciplined teammate, not a stitched-together rule dump.",
		"Keep the architectural boundary explicit and carry forward verification needs in natural language.",
	],
	suggestedAdditions: [...hiddenRequirements.slice(0, 2), ...nextTurnStance.slice(0, 2)],
	rewrittenReply: `I would keep this change aligned to the existing direction and focus directly on ${requestText.toLowerCase()} without broad refactoring. I would also keep the relevant constraints and verification needs visible in the next step.`,
	correctionSummaryAddendum: "Semantic CARA added a more natural repair phrasing pass on top of the deterministic Balloon baseline.",
}

process.stdout.write(`${JSON.stringify(response)}\n`)
