import type {
	BalloonGap,
	BalloonSessionSummary,
	HiddenRequirement,
	ProxyTrickle,
	ReleasePacket,
	RetrievalHit,
	SemanticCaraResult,
	StagedBalloonResult,
	StructuredProfile,
} from "./types"
import { BalloonStateStore } from "./BalloonStateStore"
import { auditLatestTurn, buildProxyTrickle, buildStructuredProfile, detectHiddenRequirements, retrieveRelevantTurns, summarizeMemoryPromotion } from "./BalloonAnalysis"
import { buildBalloonRepairBundle } from "./BalloonRepair"
import { buildReviewPromptBundle } from "./BalloonPrompts"
import { buildStagedBalloonResult } from "./BalloonStaged"

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
				const baseline = buildBalloonRepairBundle(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticMode: "off",
				})
				if (!baseline) return toolError(`Could not build the benchmark comparison for session ${sessionId}.`)
				const assist = buildBalloonRepairBundle(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					semanticMode: "assist",
					semanticAdapterPath: args.semanticAdapterPath,
					semanticTimeoutMs: args.semanticTimeoutMs,
					semanticMaxNotes: args.semanticMaxNotes,
				})
				if (!assist) return toolError(`Could not build the assist lane for session ${sessionId}.`)
				const staged = buildStagedBalloonResult(context.store, sessionId, {
					userRequest: asString(args.userRequest) ?? undefined,
					latestResponse: asString(args.latestResponse) ?? undefined,
					forceStageCount: args.forceStageCount ?? 3,
					stageThresholds: args.stageThresholds,
				})
				if (!staged) return toolError(`Could not build the staged lane for session ${sessionId}.`)
				const baselineReply = baseline.latestResponse ?? "(no latest assistant response found)"
				const baselineDiffers = baselineReply.trim() !== baseline.repairedReply.trim()
				const assistDiffers = assist.repairedReply.trim() !== baseline.repairedReply.trim()
				const stagedDiffers = staged.stagedReply.trim() !== baseline.repairedReply.trim()
				const text = [
					"Balloon benchmark lane comparison ready.",
					"",
					"Baseline reply",
					baselineReply,
					"",
					"Deterministic Balloon",
					baseline.repairedReply,
					"",
					"Assist Balloon",
					assist.repairedReply,
					"",
					"Staged external Balloon",
					staged.stagedReply,
					"",
					"Lane deltas",
					`Baseline differs from deterministic: ${baselineDiffers ? "yes" : "no"}`,
					`Assist differs from deterministic: ${assistDiffers ? "yes" : "no"}`,
					`Staged differs from deterministic: ${stagedDiffers ? "yes" : "no"}`,
					`Assist semantic status: ${assist.semanticCara.status}`,
					`Staged active stages: ${staged.activeStageCount}`,
					"",
					"Staged release packet",
					formatReleasePacket(staged.releasePacket),
				].join("\n")
				return textResult(text, {
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
					baselineDiffers,
					assistDiffers,
					stagedDiffers,
					assistSemanticCara: assist.semanticCara,
					assistReleasePacket: assist.releasePacket,
					stagedReleasePacket: staged.releasePacket,
					stagedActiveStageCount: staged.activeStageCount,
					stagedThresholds: staged.thresholds,
					stagedStages: staged.stages,
				})
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
	return store.listSessionSummaries().flatMap((summary) => [
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
	])
}

export function readBalloonResource(store: BalloonStateStore, uri: string): ResourceContent | null {
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
