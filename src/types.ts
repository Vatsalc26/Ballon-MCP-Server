export type BalloonTurnRole = "user" | "assistant" | "system"

export interface BalloonTurn {
	turnId: string
	role: BalloonTurnRole
	content: string
	timestamp: string
}

export interface StructuredProfile {
	sessionId: string
	goals: string[]
	constraints: string[]
	nonGoals: string[]
	protectedAreas: string[]
	protectedInterfaces: string[]
	styleRequirements: string[]
	verificationObligations: string[]
	architectureDirection: string[]
	assumptions: string[]
	updatedAt: string
	sourceTurnCount: number
}

export type BalloonGapType =
	| "profile_contradiction"
	| "constraint_omission"
	| "temporal_drift"
	| "sycophantic_drift"
	| "architecture_drift"
	| "hidden_requirement_omission"

export type BalloonGapSeverity = "low" | "medium" | "high"

export interface BalloonGap {
	gapId: string
	sessionId: string
	type: BalloonGapType
	severity: BalloonGapSeverity
	title: string
	description: string
	evidence: string[]
	suggestedQueries: string[]
	createdAt: string
}

export interface HiddenRequirement {
	key: string
	requirement: string
	rationale: string
	coveredByResponse: boolean
}

export interface RetrievalHit {
	turnId: string
	role: BalloonTurnRole
	content: string
	score: number
	reasons: string[]
}

export interface ProxyTrickle {
	trickleId: string
	sessionId: string
	summary: string
	priorityInstructions: string[]
	retrievalAnchors: string[]
	provenance: string[]
	deliveryText: string
	createdAt: string
}

export interface MemoryLedgerItem {
	itemKey: string
	itemText: string
	count: number
	status: "observed" | "reinforced" | "solidified"
	lastReason: string
	updatedAt: string
}

export interface BalloonSessionSummary {
	sessionId: string
	turnCount: number
	gapCount: number
	trickleCount: number
	memoryCount: number
	lastUpdatedAt: string | null
}

export type SemanticCaraMode = "off" | "shadow" | "assist"

export type SemanticCaraStatus = "disabled" | "shadow" | "assisted" | "error"

export interface SemanticCaraConfig {
	mode: SemanticCaraMode
	adapterPath: string | null
	timeoutMs: number
	maxNotes: number
	source: "default" | "env" | "tool"
}

export interface SemanticCaraPacket {
	sessionId: string
	requestText: string
	latestResponse: string | null
	summaryText: string
	profile: StructuredProfile
	gaps: BalloonGap[]
	hiddenRequirements: HiddenRequirement[]
	nextTurnStance: string[]
	trickleInstructions: string[]
	retrievalAnchors: string[]
	memoryItems: string[]
	deterministicReply: string
	correctionSummary: string
}

export interface SemanticCaraResult {
	mode: SemanticCaraMode
	status: SemanticCaraStatus
	notes: string[]
	suggestedAdditions: string[]
	rewrittenReply: string | null
	correctionSummaryAddendum: string | null
	error: string | null
	providerMeta: {
		adapterPath: string | null
		requestedAdapterPath?: string | null
		durationMs: number
		source: "shadow" | "adapter"
	}
}
