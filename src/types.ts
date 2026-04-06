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

export type ReleaseSourceKind = "memory" | "trickle"

export interface ReleasedCorrection {
	releaseId: string
	sessionId: string
	sourceKind: ReleaseSourceKind
	sourceId: string
	sourceText: string
	similarityScore: number
	threshold: number
	matchedTerms: string[]
	released: boolean
	status?: MemoryLedgerItem["status"]
	createdAt: string
}

export interface ReleasePacket {
	packetId: string
	sessionId: string
	queryText: string
	released: ReleasedCorrection[]
	held: ReleasedCorrection[]
	summary: string
	deliveryText: string
	createdAt: string
}

export type StagedBalloonStageId = "early" | "mid" | "deep"

export interface StagedBalloonStage {
	stageId: StagedBalloonStageId
	label: string
	active: boolean
	reason: string
	gaps: BalloonGap[]
	hiddenRequirements: HiddenRequirement[]
	retrievalHits: RetrievalHit[]
	trickleInstructions: string[]
	releasedCorrections: ReleasedCorrection[]
	stageSummary: string
}

export interface StagedBalloonResult {
	sessionId: string
	turnCount: number
	thresholds: number[]
	forcedStageCount: number | null
	activeStageCount: number
	stages: StagedBalloonStage[]
	releasePacket: ReleasePacket
	deterministicReply: string
	stagedReply: string
	deterministicCorrectionSummary: string
	stagedCorrectionSummary: string
}

export interface BenchmarkLaneComparison {
	sessionId: string
	requestText: string
	latestResponse: string | null
	baselineReply: string
	deterministicReply: string
	assistReply: string
	stagedReply: string
	deterministicCorrectionSummary: string
	assistCorrectionSummary: string
	stagedCorrectionSummary: string
	baselineDiffers: boolean
	assistDiffers: boolean
	stagedDiffers: boolean
	assistSemanticCara: SemanticCaraResult
	assistReleasePacket: ReleasePacket
	stagedReleasePacket: ReleasePacket
	stagedActiveStageCount: number
	stagedThresholds: number[]
	stagedStages: StagedBalloonStage[]
}

export interface LongSessionBenchmarkCheckpoint {
	checkpoint: number
	actualTurnCount: number
	checkpointSessionId: string
	requestText: string
	latestResponse: string | null
	comparison: BenchmarkLaneComparison
}

export interface LongSessionBenchmarkResult {
	sessionId: string
	totalTurnCount: number
	requestedCheckpoints: number[]
	executedCheckpoints: LongSessionBenchmarkCheckpoint[]
	forceStageCount: number | null
}

export interface LongSessionBenchmarkCheckpointScore {
	checkpoint: number
	actualTurnCount: number
	checkpointSessionId: string
	scorecard: BalloonBenchmarkScorecard
}

export interface LongSessionBenchmarkScoreResult {
	sessionId: string
	totalTurnCount: number
	requestedCheckpoints: number[]
	executedCheckpoints: LongSessionBenchmarkCheckpointScore[]
	laneTotals: BalloonBenchmarkLaneTotals
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
}

export type SlopCodeDatasetVerificationStatus = "verified" | "partial" | "missing"

export interface SlopCodeDatasetStatus {
	datasetRoot: string | null
	present: boolean
	hasGitMetadata: boolean
	verificationStatus: SlopCodeDatasetVerificationStatus
	warnings: string[]
}

export interface SlopCodeStarterSuiteEntry {
	problemName: string
	category: string
	difficulty: string
	checkpointCount: number
	entryFile: string
	recommendedCheckpointBatch: number[]
	recommendedForceStageCount: number
	recommendedLongSessionThresholds: number[]
	antiSlopSignals: string[]
	rationale: string
	openingPressure: string
	closingPressure: string
}

export interface SlopCodeCheckpointFile {
	checkpoint: number
	path: string | null
	exists: boolean
}

export interface SlopCodeStarterSuiteResult {
	suiteName: string
	datasetStatus: SlopCodeDatasetStatus
	problemCount: number
	entries: SlopCodeStarterSuiteEntry[]
}

export interface BalloonBenchmarkScoreDimension {
	key: "constraint_preservation" | "architecture_preservation" | "verification_carry_forward" | "omission_recovery" | "boundedness" | "clarity"
	label: string
	description: string
}

export interface BalloonBenchmarkDimensionScore {
	key: BalloonBenchmarkScoreDimension["key"]
	label: string
	score: number
	rationale: string
}

export interface BalloonBenchmarkLaneScore {
	lane: "baseline" | "deterministic" | "assist" | "staged"
	total: number
	maxTotal: number
	dimensionScores: BalloonBenchmarkDimensionScore[]
	summary: string
}

export interface BalloonBenchmarkScorecard {
	sessionId: string
	dimensions: BalloonBenchmarkScoreDimension[]
	baseline: BalloonBenchmarkLaneScore
	deterministic: BalloonBenchmarkLaneScore
	assist: BalloonBenchmarkLaneScore
	staged: BalloonBenchmarkLaneScore
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
	deltas: {
		deterministicVsBaseline: number
		assistVsDeterministic: number
		stagedVsDeterministic: number
	}
}

export interface BalloonBenchmarkLaneTotals {
	baseline: number
	deterministic: number
	assist: number
	staged: number
	maxTotal: number
}

export interface SlopCodeProblemPreparation {
	problemName: string
	datasetStatus: SlopCodeDatasetStatus
	entry: SlopCodeStarterSuiteEntry
	problemDir: string | null
	configPath: string | null
	staticAssetsPath: string | null
	testsDirPath: string | null
	checkpointFiles: SlopCodeCheckpointFile[]
	missingFiles: string[]
	recommendedSessionId: string
	recommendedInstructions: string[]
	suggestedCompareBenchmarkPrompt: string
}

export interface SlopCodeStarterBenchmarkProblemPlan {
	problemName: string
	category: string
	difficulty: string
	recommendedSessionId: string
	recommendedCheckpointBatch: number[]
	recommendedForceStageCount: number
	recommendedLongSessionThresholds: number[]
	scoreFocus: string[]
	successSignals: string[]
	suggestedCompareBenchmarkPrompt: string
	suggestedScorePrompt: string
	suggestedLongSessionPrompt: string
}

export interface SlopCodeStarterBenchmarkPlan {
	suiteName: string
	datasetStatus: SlopCodeDatasetStatus
	executionOrder: string[]
	scoreDimensions: BalloonBenchmarkScoreDimension[]
	runChecklist: string[]
	communicationBoundaries: string[]
	problems: SlopCodeStarterBenchmarkProblemPlan[]
}

export interface SlopCodeStarterSuiteProblemSummary {
	problemName: string
	sessionId: string
	recommendedCheckpoints: number[]
	sessionPresent: boolean
	executedCheckpoints: number[]
	scoreResult: LongSessionBenchmarkScoreResult | null
	warnings: string[]
}

export interface SlopCodeStarterSuiteSummary {
	suiteName: string
	datasetStatus: SlopCodeDatasetStatus
	totalProblems: number
	coveredProblems: number
	laneTotals: BalloonBenchmarkLaneTotals
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
	problems: SlopCodeStarterSuiteProblemSummary[]
}

export interface BalloonSessionSummary {
	sessionId: string
	turnCount: number
	gapCount: number
	trickleCount: number
	memoryCount: number
	releaseCount: number
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
