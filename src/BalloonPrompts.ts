import { BalloonStateStore } from "./BalloonStateStore"
import { buildBalloonRepairBundle, type RepairPromptMessage } from "./BalloonRepair"

type PromptArgument = {
	name: string
	title: string
	description: string
	required?: boolean
}

export type PromptDefinition = {
	name: string
	title: string
	description: string
	arguments?: PromptArgument[]
}

export type PromptMessage = RepairPromptMessage

export type PromptResult = {
	description: string
	messages: PromptMessage[]
}

export type ReviewPromptBundle = PromptResult & {
	summaryText: string
	gaps: ReturnType<BalloonStateStore["getRecentGaps"]>
	trickles: ReturnType<BalloonStateStore["getRecentTrickles"]>
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
	if (!summary) return `Session: ${sessionId}\nTurns: 0\nGaps: 0\nTrickles: 0\nMemory items: 0\nLast updated: unknown`
	return [
		`Session: ${summary.sessionId}`,
		`Turns: ${summary.turnCount}`,
		`Gaps: ${summary.gapCount}`,
		`Trickles: ${summary.trickleCount}`,
		`Memory items: ${summary.memoryCount}`,
		`Last updated: ${summary.lastUpdatedAt ?? "unknown"}`,
	].join("\n")
}

export function listBalloonPrompts(): PromptDefinition[] {
	return [
		{
			name: "balloon/repair-next-turn",
			title: "Repair Next Turn With Balloon",
			description: "Build a next-turn repair prompt from recent Balloon profile, gaps, trickles, and memory.",
			arguments: [
				{
					name: "sessionId",
					title: "Session Id",
					description: "Balloon session to read from.",
					required: true,
				},
				{
					name: "userRequest",
					title: "User Request",
					description: "Optional explicit user request to preserve while repairing the next turn.",
					required: false,
				},
			],
		},
		{
			name: "balloon/review-session-drift",
			title: "Review Balloon Session Drift",
			description: "Build a prompt that asks the host model to inspect recent Balloon drift and explain what is going wrong.",
			arguments: [
				{
					name: "sessionId",
					title: "Session Id",
					description: "Balloon session to review.",
					required: true,
				},
			],
		},
	]
}

function buildRepairPrompt(store: BalloonStateStore, sessionId: string, userRequest?: string): PromptResult {
	const bundle = buildBalloonRepairBundle(store, sessionId, { userRequest })
	if (!bundle) {
		return {
			description: "Repair the next answer using current Balloon context, without overriding the user's intended direction.",
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: "Repair the next answer using the stored Balloon context.",
					},
				},
			],
		}
	}

	return {
		description: "Repair the next answer using current Balloon context, without overriding the user's intended direction.",
		messages: bundle.messages,
	}
}

export function buildReviewPromptBundle(store: BalloonStateStore, sessionId: string): ReviewPromptBundle {
	const summary = buildSessionSummaryText(store, sessionId)
	const gaps = store.getRecentGaps(sessionId, 8)
	const trickles = store.getRecentTrickles(sessionId, 3)

	const reviewText = [
		"Review this Balloon session for context-fidelity failure.",
		"Do not solve the task directly. Diagnose the drift and name the smallest safe correction path.",
		"",
		"Session summary",
		summary,
		"",
		"Recent gaps",
		formatList(gaps.map((gap) => `${gap.type} | ${gap.severity} | ${gap.title} | ${gap.description}`), "No recent gaps recorded."),
		"",
		"Recent proxy trickles",
		formatList(trickles.map((trickle) => `${trickle.summary} -> ${trickle.priorityInstructions.join("; ")}`), "No recent trickles recorded."),
		"",
		"Return exactly these sections:",
		"1. Drift class",
		"2. Violated context",
		"3. Corrective pressure",
		"4. Smallest safe next step",
		"",
		"Keep the diagnosis concrete and brief.",
	]

	return {
		description: "Ask the host model to review current Balloon drift and explain the needed correction path.",
		summaryText: summary,
		gaps,
		trickles,
		messages: [
			{
				role: "user",
				content: {
					type: "text",
					text: reviewText.join("\n"),
				},
			},
		],
	}
}

export function getBalloonPrompt(store: BalloonStateStore, name: string, rawArgs: Record<string, unknown>): PromptResult | null {
	const sessionId = asString(rawArgs.sessionId)
	if (!sessionId) return null

	switch (name) {
		case "balloon/repair-next-turn":
			return buildRepairPrompt(store, sessionId, asString(rawArgs.userRequest) ?? undefined)
		case "balloon/review-session-drift":
			return buildReviewPromptBundle(store, sessionId)
		default:
			return null
	}
}
