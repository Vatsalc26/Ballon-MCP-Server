import { BalloonStateStore } from "./BalloonStateStore"
import { buildSessionSummaryText } from "./BalloonTools"

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

export type PromptMessage = {
	role: "user" | "assistant" | "system"
	content: {
		type: "text"
		text: string
	}
}

export type PromptResult = {
	description: string
	messages: PromptMessage[]
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
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

function formatList(values: string[], fallback: string): string {
	if (values.length === 0) return fallback
	return values.map((value, index) => `${index + 1}. ${value}`).join("\n")
}

function buildRepairPrompt(store: BalloonStateStore, sessionId: string, userRequest?: string): PromptResult {
	const profile = store.getProfile(sessionId)
	const gaps = store.getRecentGaps(sessionId, 5)
	const trickle = store.getRecentTrickles(sessionId, 1)[0]
	const memory = store.getMemoryLedger(sessionId).slice(0, 5)
	const summary = buildSessionSummaryText(store, sessionId)

	const systemSections = [
		"You are preparing the next assistant turn in a Balloon-governed session.",
		"Your job is to restore context fidelity without taking control away from the user.",
		"Use the stored profile, recent gaps, proxy trickle, and memory items as low-volume corrective pressure.",
		"Do not mention Balloon, CARA, auditing, or trickle unless the user explicitly asks.",
		"Prefer the smallest safe reply that gets the session back on track.",
		"",
		"Session summary",
		summary,
		"",
		"Known goals",
		formatList(profile?.goals ?? [], "No explicit goals recorded."),
		"",
		"Known constraints",
		formatList(profile?.constraints ?? [], "No explicit constraints recorded."),
		"",
		"Protected areas",
		formatList(profile?.protectedAreas ?? [], "No protected areas recorded."),
		"",
		"Recent gaps to correct",
		formatList(gaps.map((gap) => `${gap.title}: ${gap.description}`), "No recent gaps recorded."),
		"",
		"Proxy trickle instructions",
		formatList(trickle?.priorityInstructions ?? [], "No proxy trickle instructions recorded."),
		"",
		"Reinforced memory items",
		formatList(memory.map((item) => `${item.itemText} (${item.status})`), "No reinforced memory items recorded."),
		"",
		"Response requirements",
		"1. Answer the current request directly.",
		"2. Preserve established architecture, constraints, and protected areas.",
		"3. Carry forward verification obligations when they matter to correctness.",
		"4. Include material follow-on requirements if the current reply would otherwise miss them.",
		"5. Avoid agreement-heavy filler and avoid broad rewrites unless the stored context explicitly requires them.",
	]

	const requestText =
		userRequest ??
		store
			.getTurns(sessionId, 100)
			.filter((turn) => turn.role === "user")
			.slice(-1)[0]?.content ??
		"Repair the next answer using the Balloon context above."

	return {
		description: "Repair the next answer using current Balloon context, without overriding the user's intended direction.",
		messages: [
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
		],
	}
}

function buildReviewPrompt(store: BalloonStateStore, sessionId: string): PromptResult {
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
			return buildReviewPrompt(store, sessionId)
		default:
			return null
	}
}
