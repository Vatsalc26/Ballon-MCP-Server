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

export type BalloonCoverageQuality = "weak" | "partial" | "strong"

export type BalloonDriftPressureLevel = "low" | "guarded" | "high" | "critical"

export interface BalloonDriftPressure {
	sessionId: string
	score: number
	level: BalloonDriftPressureLevel
	gapCount: number
	highSeverityGapCount: number
	dominantGapTypes: BalloonGapType[]
	requestCoverage: BalloonCoverageQuality
	profileAnchorCoverage: BalloonCoverageQuality
	needsArchitectureRecovery: boolean
	needsVerificationRecovery: boolean
	needsProtectedAreaRecovery: boolean
	needsInterfaceRecovery: boolean
	needsStyleRecovery: boolean
	needsHiddenRequirementRecovery: boolean
	reasons: string[]
}

export type BalloonDriftPressureSource = "run_cycle" | "audit_turn" | "repair_packet" | "staged_cycle" | "review"

export interface BalloonDriftPressureSnapshot {
	snapshotId: string
	sessionId: string
	source: BalloonDriftPressureSource
	turnCount: number
	requestText: string | null
	latestResponse: string | null
	recordedAt: string
	pressure: BalloonDriftPressure
}

export type BalloonDriftTrend = "insufficient_data" | "stable" | "rising" | "falling" | "mixed"

export interface BalloonDriftPressureHistorySummary {
	sessionId: string
	totalSnapshots: number
	latestScore: number | null
	latestLevel: BalloonDriftPressureLevel | null
	peakScore: number | null
	averageScore: number | null
	trend: BalloonDriftTrend
	reasons: string[]
	recentSnapshots: BalloonDriftPressureSnapshot[]
}

export type BalloonPersistentDriftFocus = "request_reanchor" | "architecture" | "verification" | "protected_area" | "interface" | "style" | "hidden_requirement"

export interface BalloonPersistentDriftBias {
	sessionId: string
	focusOrder: BalloonPersistentDriftFocus[]
	sustainedPressure: boolean
	repeatedGapTypes: BalloonGapType[]
	queryBoosts: string[]
	reasons: string[]
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
	biasReasons: string[]
}

export interface ProxyTrickle {
	trickleId: string
	sessionId: string
	summary: string
	persistentFocus: BalloonPersistentDriftFocus[]
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
	biasReasons: string[]
	released: boolean
	status?: MemoryLedgerItem["status"]
	createdAt: string
}

export interface ReleasePacket {
	packetId: string
	sessionId: string
	queryText: string
	persistentFocus: BalloonPersistentDriftFocus[]
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
	driftPressure: BalloonDriftPressure
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
	deterministicDriftPressure: BalloonDriftPressure
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

export type LongSessionCheckpointMode = "turn_count" | "assistant_checkpoint"

export interface LongSessionBenchmarkCheckpoint {
	checkpoint: number
	actualTurnCount: number
	checkpointSessionId: string
	requestText: string
	latestResponse: string | null
	comparison: BenchmarkLaneComparison
	driftPressure: BalloonDriftPressure
}

export interface LongSessionBenchmarkResult {
	sessionId: string
	totalTurnCount: number
	requestedCheckpoints: number[]
	checkpointMode: LongSessionCheckpointMode
	executedCheckpoints: LongSessionBenchmarkCheckpoint[]
	pressureHistory: BalloonDriftPressureHistorySummary
	forceStageCount: number | null
}

export interface LongSessionBenchmarkCheckpointScore {
	checkpoint: number
	actualTurnCount: number
	checkpointSessionId: string
	scorecard: BalloonBenchmarkScorecard
	driftPressure: BalloonDriftPressure
}

export interface LongSessionBenchmarkScoreResult {
	sessionId: string
	totalTurnCount: number
	requestedCheckpoints: number[]
	checkpointMode: LongSessionCheckpointMode
	executedCheckpoints: LongSessionBenchmarkCheckpointScore[]
	pressureHistory: BalloonDriftPressureHistorySummary
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
	recommendedCheckpointMode: LongSessionCheckpointMode
	recommendedInstructions: string[]
	suggestedCompareBenchmarkPrompt: string
}

export interface SlopCodeStarterBenchmarkProblemPlan {
	problemName: string
	category: string
	difficulty: string
	recommendedSessionId: string
	recommendedCheckpointMode: LongSessionCheckpointMode
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
	recommendedSessionId: string
	sessionSource: "recommended" | "evidence_recent" | "none"
	recommendedCheckpoints: number[]
	sessionPresent: boolean
	executedCheckpoints: number[]
	scoreResult: LongSessionBenchmarkScoreResult | null
	evidenceSummary: BalloonSlopCodeProblemEvidenceSummary
	warnings: string[]
}

export interface SlopCodeStarterSuiteSummary {
	suiteName: string
	datasetStatus: SlopCodeDatasetStatus
	totalProblems: number
	coveredProblems: number
	laneTotals: BalloonBenchmarkLaneTotals
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
	evidenceSummary: BalloonSlopCodeEvidenceSummary
	problems: SlopCodeStarterSuiteProblemSummary[]
}

export interface BalloonSlopCodeLiveRunStep {
	stepId: "dataset_verify" | "host_validate" | "problem_prepare" | "live_run" | "score" | "record_evidence" | "export_artifacts" | "finalize_run"
	title: string
	goal: string
	toolName: string | null
	toolArgs: Record<string, unknown> | null
	notes: string[]
}

export interface BalloonSlopCodeLiveRunPacket {
	problemName: string
	host: BalloonHostKind
	hostDisplayName: string
	sessionId: string
	provider: string | null
	model: string | null
	datasetStatus: SlopCodeDatasetStatus
	problemPreparation: SlopCodeProblemPreparation
	evidenceTarget: {
		evidenceKind: "live_llm"
		transcriptSource: "live_host_session"
		host: BalloonHostKind
		provider: string | null
		model: string | null
		checkpointMode: LongSessionCheckpointMode
		checkpoints: number[]
	}
	validationResourceUri: string
	evidenceResourceUri: string
	docsPath: string
	warnings: string[]
	claimBoundary: string[]
	steps: BalloonSlopCodeLiveRunStep[]
}

export interface BalloonSlopCodeLiveRunFinalizePacket {
	problemName: string
	host: BalloonHostKind
	hostDisplayName: string
	sessionId: string
	recommendedSessionId: string
	provider: string | null
	model: string | null
	evidenceKind: BalloonSlopCodeEvidenceKind
	transcriptSource: BalloonSlopCodeTranscriptSource
	mergeMode: "replace" | "append"
	datasetStatus: SlopCodeDatasetStatus
	recommendedCheckpoints: number[]
	checkpointCount: number
	turnPlaceholders: Array<{
		checkpoint: number
		userContent: string
		assistantContent: string
	}>
	request: {
		tool: "balloon_finalize_slopcode_live_run"
		arguments: Record<string, unknown>
	}
	copyPastePrompt: string
	warnings: string[]
	notes: string[]
}

export interface BalloonSlopCodeLiveRunBatchPacket {
	host: BalloonHostKind
	hostDisplayName: string
	sessionIdPrefix: string | null
	provider: string | null
	model: string | null
	datasetStatus: SlopCodeDatasetStatus
	totalProblems: number
	selectedProblems: string[]
	warnings: string[]
	nextActions: string[]
	packets: BalloonSlopCodeLiveRunPacket[]
}

export interface BalloonSlopCodeLiveRunFinalizationArtifacts {
	outputDir: string
	summaryJsonPath: string
	summaryMarkdownPath: string
	problemJsonPath: string | null
	problemMarkdownPath: string | null
	evidenceCoverage: BalloonSlopCodeEvidenceCoverage
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
	evidenceAlerts: string[]
	pressureAlerts: string[]
}

export interface BalloonSlopCodeLiveRunFinalization {
	problemName: string
	sessionId: string
	recommendedSessionId: string
	sessionSource: "recommended" | "evidence_recent"
	host: BalloonHostKind | null
	provider: string | null
	model: string | null
	mergeMode: "replace" | "append"
	turnsMerged: number
	totalTurnCount: number
	datasetStatus: SlopCodeDatasetStatus
	scoreResult: LongSessionBenchmarkScoreResult
	evidence: BalloonSlopCodeRunEvidence
	artifacts: BalloonSlopCodeLiveRunFinalizationArtifacts
	warnings: string[]
	nextActions: string[]
}

export interface BalloonSlopCodeLiveRunBatchFinalization {
	host: BalloonHostKind | null
	provider: string | null
	model: string | null
	datasetStatus: SlopCodeDatasetStatus | null
	outputDir: string
	summaryJsonPath: string
	summaryMarkdownPath: string
	finalizedProblemNames: string[]
	evidenceSummary: BalloonSlopCodeEvidenceSummary
	topLanes: Array<BalloonBenchmarkLaneScore["lane"]>
	warnings: string[]
	nextActions: string[]
	runs: BalloonSlopCodeLiveRunFinalization[]
}

export type BalloonSlopCodeEvidenceKind = "live_llm" | "manual_replay" | "fixture" | "synthetic_demo"

export type BalloonSlopCodeTranscriptSource = "live_host_session" | "pasted_turns" | "fixture_turns" | "generated_demo"

export interface BalloonSlopCodeRunEvidence {
	runId: string
	problemName: string
	sessionId: string
	evidenceKind: BalloonSlopCodeEvidenceKind
	transcriptSource: BalloonSlopCodeTranscriptSource
	host: BalloonHostKind | null
	provider: string | null
	model: string | null
	datasetRoot: string | null
	datasetVerificationStatus: SlopCodeDatasetVerificationStatus | null
	checkpointMode: LongSessionCheckpointMode | null
	checkpoints: number[]
	notes: string[]
	recordedAt: string
}

export type BalloonSlopCodeEvidenceCoverage = "live" | "non_live_only" | "not_run"

export interface BalloonSlopCodeProblemEvidenceSummary {
	problemName: string
	totalRuns: number
	liveRuns: number
	manualReplayRuns: number
	fixtureRuns: number
	syntheticDemoRuns: number
	coverage: BalloonSlopCodeEvidenceCoverage
	latestEvidenceKind: BalloonSlopCodeEvidenceKind | null
	latestHost: BalloonHostKind | null
	latestProvider: string | null
	latestModel: string | null
	latestSessionId: string | null
	latestRecordedAt: string | null
	notes: string[]
	recentRuns: BalloonSlopCodeRunEvidence[]
}

export interface BalloonSlopCodeEvidenceSummary {
	suiteName: string
	totalRuns: number
	liveRuns: number
	manualReplayRuns: number
	fixtureRuns: number
	syntheticDemoRuns: number
	coveredProblems: number
	liveCoveredProblems: number
	problems: BalloonSlopCodeProblemEvidenceSummary[]
	openRisks: string[]
}

export type BalloonHostKind = "vscode" | "cline" | "roo_code" | "claude_desktop" | "generic_json"

export type BalloonHostReadinessTier = "recommended_first" | "promising" | "experimental" | "manual"

export type BalloonHostConfigRoot = "servers" | "mcpServers"

export type BalloonHostFlowKind = "run_cycle" | "repair_next_turn" | "review_session_drift" | "compare_benchmark_lanes" | "install_diagnostics"

export type BalloonHostChatRecommendation = "same_chat_ok" | "fresh_chat_preferred"

export interface BalloonHostSurface {
	host: BalloonHostKind
	displayName: string
	readinessTier: BalloonHostReadinessTier
	status: string
	configRoot: BalloonHostConfigRoot
	exampleConfigPath: string
	docsPath: string
	recommendedFirstTools: string[]
	promptSensitiveSurfaces: string[]
	restartHints: string[]
	knownCaveats: string[]
	notes: string[]
}

export interface BalloonHostSetupPacket {
	host: BalloonHostKind
	displayName: string
	readinessTier: BalloonHostReadinessTier
	status: string
	configRoot: BalloonHostConfigRoot
	repoPath: string
	command: string
	args: string[]
	cwd: string
	dataDir: string
	resolvedStartPath: string | null
	buildReady: boolean
	configSnippet: string
	exampleConfigPath: string
	docsPath: string
	recommendedFirstTools: string[]
	promptSensitiveSurfaces: string[]
	restartHints: string[]
	validationWarnings: string[]
	firstRunChecklist: string[]
}

export interface BalloonHostSetupValidation {
	host: BalloonHostKind
	displayName: string
	configSource: string
	expectedConfigRoot: BalloonHostConfigRoot
	actualConfigRoot: BalloonHostConfigRoot | "unknown"
	foundServerEntry: boolean
	valid: boolean
	command: string | null
	args: string[]
	cwd: string | null
	resolvedCwd: string | null
	resolvedStartPath: string | null
	buildReady: boolean | null
	errors: string[]
	warnings: string[]
	suggestedFixes: string[]
}

export interface BalloonInstallDiagnostics {
	host: BalloonHostKind | null
	hostDisplayName: string | null
	configCheckMode: "none" | "generated" | "provided"
	repoPath: string
	buildReady: boolean
	resolvedStartPath: string | null
	toolCount: number
	promptCount: number
	resourceCount: number
	recommendedFirstTools: string[]
	promptSensitiveSurfaces: string[]
	promptFallbackReady: boolean
	benchmarkSurfaceReady: boolean
	hostConfigValidation: BalloonHostSetupValidation | null
	overallReady: boolean
	warnings: string[]
	recommendedNextSteps: string[]
}

export interface BalloonHostPromptPacketMessage {
	role: "user" | "assistant" | "system"
	text: string
}

export interface BalloonHostPromptPacket {
	name: string
	description: string
	messages: BalloonHostPromptPacketMessage[]
}

export interface BalloonHostFlowPacket {
	host: BalloonHostKind
	displayName: string
	readinessTier: BalloonHostReadinessTier
	status: string
	flow: BalloonHostFlowKind
	title: string
	summary: string
	preferredSurface: "tool" | "prompt" | "resource"
	alternateSurface: "tool" | "prompt" | "resource" | "none"
	recommendedChatState: BalloonHostChatRecommendation
	docsPath: string
	exampleRequestPath: string | null
	toolName: string | null
	toolArgs: Record<string, unknown> | null
	promptName: string | null
	promptArgs: Record<string, unknown> | null
	promptPacket: BalloonHostPromptPacket | null
	instructions: string[]
	ifHostFeelsFlaky: string[]
	restartHints: string[]
	warnings: string[]
}

export type BalloonHostValidationCaseId =
	| "install_doctor"
	| "same_chat_tool_repair"
	| "fresh_chat_prompt_repair"
	| "fresh_chat_prompt_review"
	| "same_chat_benchmark_compare"

export interface BalloonHostValidationCase {
	caseId: BalloonHostValidationCaseId
	title: string
	goal: string
	chatStateUnderTest: BalloonHostChatRecommendation
	primarySurfaceUnderTest: "tool" | "prompt" | "resource"
	prerequisitePackets: BalloonHostFlowPacket[]
	primaryPacket: BalloonHostFlowPacket
	steps: string[]
	successSignals: string[]
	failureSignals: string[]
}

export interface BalloonHostValidationSuite {
	host: BalloonHostKind
	displayName: string
	readinessTier: BalloonHostReadinessTier
	status: string
	docsPath: string
	validationDocPath: string
	summary: string
	recommendedOrder: BalloonHostValidationCaseId[]
	cases: BalloonHostValidationCase[]
	warnings: string[]
}

export type BalloonHostValidationResultStatus = "pass" | "partial" | "fail"

export interface BalloonHostValidationEvidence {
	runId: string
	host: BalloonHostKind
	caseId: BalloonHostValidationCaseId
	status: BalloonHostValidationResultStatus
	chatStateUnderTest: BalloonHostChatRecommendation
	summary: string
	findings: string[]
	suggestedFixes: string[]
	sessionId: string | null
	hostVersion: string | null
	recordedAt: string
}

export interface BalloonHostValidationCaseEvidenceRollup {
	caseId: BalloonHostValidationCaseId
	title: string
	latestStatus: BalloonHostValidationResultStatus | "not_run"
	latestSummary: string | null
	totalRuns: number
	passCount: number
	partialCount: number
	failCount: number
	lastRecordedAt: string | null
}

export interface BalloonHostValidationEvidenceSummary {
	host: BalloonHostKind
	displayName: string
	readinessTier: BalloonHostReadinessTier
	status: string
	totalRuns: number
	passCount: number
	partialCount: number
	failCount: number
	latestRecordedAt: string | null
	coverage: {
		completedCases: number
		totalCases: number
	}
	cases: BalloonHostValidationCaseEvidenceRollup[]
	recentRuns: BalloonHostValidationEvidence[]
	openRisks: string[]
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
