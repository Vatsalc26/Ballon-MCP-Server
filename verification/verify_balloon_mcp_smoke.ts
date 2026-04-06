import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

type JsonRpcError = {
	code: number
	message: string
	data?: unknown
}

type PendingRequest = {
	resolve: (value: unknown) => void
	reject: (reason?: unknown) => void
	timeout: NodeJS.Timeout
}

type SmokeResult = {
	initializePassed: boolean
	toolSurfacePassed: boolean
	promptSurfacePassed: boolean
	heroCyclePassed: boolean
	repairFallbackWorked: boolean
	semanticCaraPreviewWorked: boolean
	semanticCaraAssistWorked: boolean
	compareRepairLanesWorked: boolean
	stagedCycleWorked: boolean
	benchmarkLaneCompareWorked: boolean
	benchmarkLaneScoreWorked: boolean
	longSessionBenchmarkScoreWorked: boolean
	hostSetupPacketWorked: boolean
	hostSetupValidationWorked: boolean
	installDiagnosticsWorked: boolean
	hostFlowPacketWorked: boolean
	hostValidationSuiteWorked: boolean
	hostValidationEvidenceWorked: boolean
	slopcodeStarterSuiteWorked: boolean
	slopcodeStarterRunbookWorked: boolean
	slopcodeStarterSummaryWorked: boolean
	slopcodeStarterArtifactExportWorked: boolean
	slopcodeProblemPrepWorked: boolean
	reviewDriftFallbackWorked: boolean
	profileBuilt: boolean
	gapAuditWorked: boolean
	trickleGenerated: boolean
	memoryLedgerUpdated: boolean
	resourceReadWorked: boolean
	releaseResourceWorked: boolean
	details: string[]
	stderr: string
}

function resolveRootDir(): string {
	let current = path.resolve(__dirname)
	for (let depth = 0; depth < 8; depth += 1) {
		if (fs.existsSync(path.join(current, "package.json"))) return current
		const parent = path.dirname(current)
		if (parent === current) break
		current = parent
	}
	throw new Error(`Could not resolve repo root from ${__dirname}`)
}

function resolveVerificationDir(rootDir: string): string {
	const monorepoDir = path.join(rootDir, "Ballon_architecture", "balloon_mcp_server", "verification")
	if (fs.existsSync(monorepoDir)) return monorepoDir
	return path.join(rootDir, "verification")
}

function createTempDataDir(rootDir: string): string {
	const dir = path.join(resolveVerificationDir(rootDir), `.tmp-balloon-mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`)
	fs.mkdirSync(dir, { recursive: true })
	return dir
}

function removeDirSafe(dir: string): void {
	if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

class FramedJsonRpcClient {
	private readonly child: ChildProcessWithoutNullStreams
	private readonly pending = new Map<number, PendingRequest>()
	private buffer = Buffer.alloc(0)
	private nextId = 1
	public stderr = ""

	constructor(child: ChildProcessWithoutNullStreams) {
		this.child = child
		child.stdout.on("data", (chunk) => {
			const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
			this.buffer = Buffer.concat([this.buffer, incoming])
			this.consumeBuffer()
		})
		child.stderr.on("data", (chunk) => {
			this.stderr += String(chunk)
		})
		child.once("close", (code, signal) => {
			for (const [id, pending] of this.pending) {
				clearTimeout(pending.timeout)
				const stderrSuffix = this.stderr.trim() ? `\nStderr:\n${this.stderr.trim()}` : ""
				pending.reject(new Error(`balloon MCP process closed before response ${id} (code=${code}, signal=${signal})${stderrSuffix}`))
			}
			this.pending.clear()
		})
	}

	async request(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
		const id = this.nextId++
		const payload = {
			jsonrpc: "2.0",
			id,
			method,
			params,
		}
		const promise = new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id)
				reject(new Error(`Timed out waiting for response to ${method}`))
			}, timeoutMs)
			timeout.unref?.()
			this.pending.set(id, { resolve, reject, timeout })
		})
		this.writeFrame(payload)
		return await promise
	}

	notify(method: string, params: Record<string, unknown>): void {
		this.writeFrame({
			jsonrpc: "2.0",
			method,
			params,
		})
	}

	private writeFrame(payload: Record<string, unknown>): void {
		const json = JSON.stringify(payload)
		const frame = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`
		this.child.stdin.write(frame, "utf8")
	}

	private consumeBuffer(): void {
		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n")
			if (headerEnd === -1) return
			const header = this.buffer.subarray(0, headerEnd).toString("utf8")
			const match = /Content-Length:\s*(\d+)/iu.exec(header)
			if (!match) {
				this.buffer = this.buffer.subarray(headerEnd + 4)
				continue
			}
			const bodyLength = Number.parseInt(match[1] ?? "0", 10)
			const frameEnd = headerEnd + 4 + bodyLength
			if (this.buffer.length < frameEnd) return
			const body = this.buffer.subarray(headerEnd + 4, frameEnd).toString("utf8")
			this.buffer = this.buffer.subarray(frameEnd)
			this.handleMessage(body)
		}
	}

	private handleMessage(body: string): void {
		const message = JSON.parse(body) as { id?: unknown; result?: unknown; error?: JsonRpcError }
		if (typeof message.id !== "number") return
		const pending = this.pending.get(message.id)
		if (!pending) return
		this.pending.delete(message.id)
		clearTimeout(pending.timeout)
		if (message.error) {
			pending.reject(new Error(`[${message.error.code}] ${message.error.message}`))
			return
		}
		pending.resolve(message.result)
	}
}

async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return
	await new Promise<void>((resolve) => {
		let done = false
		const finish = () => {
			if (done) return
			done = true
			resolve()
		}
		child.once("close", () => finish())
		try {
			child.stdin.end()
		} catch {
			// ignore stdin close failures
		}
		setTimeout(() => {
			if (child.exitCode !== null || child.signalCode !== null) return finish()
			if (process.platform === "win32" && child.pid) {
				try {
					spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
				} catch {
					// ignore cleanup failures
				}
				return
			}
			try {
				child.kill("SIGTERM")
			} catch {
				// ignore cleanup failures
			}
		}, 500)
	})
}

function hasTool(result: unknown, name: string): boolean {
	const tools = result && typeof result === "object" ? (result as { tools?: Array<{ name?: string }> }).tools : undefined
	return Array.isArray(tools) && tools.some((tool) => tool?.name === name)
}

function hasPrompt(result: unknown, name: string): boolean {
	const prompts = result && typeof result === "object" ? (result as { prompts?: Array<{ name?: string }> }).prompts : undefined
	return Array.isArray(prompts) && prompts.some((prompt) => prompt?.name === name)
}

export async function runBalloonMcpSmoke(rootDir = resolveRootDir()): Promise<SmokeResult> {
	const details: string[] = []
	const dataDir = createTempDataDir(rootDir)
	const monorepoServerPath = path.join(rootDir, "dist", "Ballon_architecture", "balloon_mcp_server", "src", "start.js")
	const publicRepoServerPath = path.join(rootDir, "dist", "src", "start.js")
	const serverPath = fs.existsSync(monorepoServerPath) ? monorepoServerPath : publicRepoServerPath
	const child = spawn(process.execPath, [serverPath, "--data-dir", dataDir], {
		cwd: rootDir,
		windowsHide: true,
		stdio: ["pipe", "pipe", "pipe"],
	})
	const client = new FramedJsonRpcClient(child)

	try {
		const initialize = (await client.request("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "balloon-mcp-smoke", version: "0.1.0" },
		})) as { protocolVersion?: string; serverInfo?: { name?: string } }
		client.notify("notifications/initialized", {})

		const initializePassed = initialize.protocolVersion === "2025-06-18" && initialize.serverInfo?.name === "balloon-mcp-server"
		details.push(`initializePassed=${initializePassed ? "yes" : "no"}`)

		const toolsList = await client.request("tools/list", {})
		const toolSurfacePassed =
			hasTool(toolsList, "balloon_run_cycle") &&
			hasTool(toolsList, "balloon_build_profile") &&
			hasTool(toolsList, "balloon_audit_turn") &&
			hasTool(toolsList, "balloon_generate_proxy_trickle") &&
			hasTool(toolsList, "balloon_repair_next_turn") &&
			hasTool(toolsList, "balloon_semantic_cara_preview") &&
			hasTool(toolsList, "balloon_compare_repair_lanes") &&
			hasTool(toolsList, "balloon_run_staged_cycle") &&
			hasTool(toolsList, "balloon_compare_benchmark_lanes") &&
			hasTool(toolsList, "balloon_score_benchmark_lanes") &&
			hasTool(toolsList, "balloon_run_long_session_benchmark") &&
			hasTool(toolsList, "balloon_score_long_session_benchmark") &&
			hasTool(toolsList, "balloon_prepare_host_setup_packet") &&
			hasTool(toolsList, "balloon_validate_host_setup") &&
			hasTool(toolsList, "balloon_run_install_diagnostics") &&
			hasTool(toolsList, "balloon_prepare_host_flow_packet") &&
			hasTool(toolsList, "balloon_prepare_host_validation_suite") &&
			hasTool(toolsList, "balloon_record_host_validation_result") &&
			hasTool(toolsList, "balloon_summarize_host_validation_results") &&
			hasTool(toolsList, "balloon_describe_slopcode_starter_suite") &&
			hasTool(toolsList, "balloon_plan_slopcode_starter_benchmark") &&
			hasTool(toolsList, "balloon_summarize_slopcode_starter_suite") &&
			hasTool(toolsList, "balloon_export_slopcode_starter_artifacts") &&
			hasTool(toolsList, "balloon_prepare_slopcode_problem") &&
			hasTool(toolsList, "balloon_review_session_drift")
		details.push(`toolSurfacePassed=${toolSurfacePassed ? "yes" : "no"}`)

		const promptsList = await client.request("prompts/list", {})
		const promptSurfacePassed = hasPrompt(promptsList, "balloon/repair-next-turn") && hasPrompt(promptsList, "balloon/review-session-drift")
		details.push(`promptSurfacePassed=${promptSurfacePassed ? "yes" : "no"}`)

		const sessionId = "demo-session"
		const latestUserRequest = "Please add retry logic to the request layer without rewriting the current router. Keep type safety and include tests."
		const latestResponse = "Absolutely, I will rewrite the router from scratch first and we can skip tests for now."

		const heroCycle = (await client.request("tools/call", {
			name: "balloon_run_cycle",
			arguments: {
				sessionId: `${sessionId}-hero`,
				turns: [
					{ role: "system", content: "Protected files: src/critical/router.ts. Do not rewrite architecture. Tests required for changes." },
					{ role: "user", content: latestUserRequest },
					{ role: "assistant", content: latestResponse },
				],
			},
		})) as {
			structuredContent?: {
				gapCount?: number
				driftPressure?: { score?: number; level?: string; reasons?: string[] }
				persistentBias?: { focusOrder?: string[]; reasons?: string[] }
				trickle?: { priorityInstructions?: string[] }
				memoryUpdates?: Array<{ count?: number }>
			}
		}
		const heroCyclePassed =
			(heroCycle.structuredContent?.gapCount ?? 0) >= 1 &&
			(heroCycle.structuredContent?.driftPressure?.score ?? 0) >= 20 &&
			(heroCycle.structuredContent?.driftPressure?.reasons?.length ?? 0) >= 1 &&
			(heroCycle.structuredContent?.persistentBias?.focusOrder?.length ?? 0) >= 1 &&
			(heroCycle.structuredContent?.persistentBias?.reasons?.length ?? 0) >= 1 &&
			(heroCycle.structuredContent?.trickle?.priorityInstructions?.length ?? 0) > 0 &&
			(heroCycle.structuredContent?.memoryUpdates?.length ?? 0) > 0
		details.push(`heroCyclePassed=${heroCyclePassed ? "yes" : "no"}`)

		const repairPrompt = (await client.request("prompts/get", {
			name: "balloon/repair-next-turn",
			arguments: { sessionId: `${sessionId}-hero`, userRequest: latestUserRequest },
		})) as { messages?: Array<{ content?: { text?: string } }> }
		const reviewPrompt = (await client.request("prompts/get", {
			name: "balloon/review-session-drift",
			arguments: { sessionId: `${sessionId}-hero` },
		})) as { messages?: Array<{ content?: { text?: string } }> }
		const repairPromptText = repairPrompt.messages?.[0]?.content?.text ?? ""
		const reviewPromptText = reviewPrompt.messages?.[0]?.content?.text ?? ""
		const promptMessagesLookUsable =
			repairPromptText.includes("Proxy trickle instructions") &&
			reviewPromptText.includes("Drift class") &&
			reviewPromptText.includes("Smallest safe next step")
		details.push(`promptMessagesLookUsable=${promptMessagesLookUsable ? "yes" : "no"}`)

		const repairFallback = (await client.request("tools/call", {
			name: "balloon_repair_next_turn",
			arguments: {
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
			},
		})) as {
			structuredContent?: {
				repairedReply?: string
				correctionSummary?: string
				driftPressure?: { level?: string; score?: number }
				persistentBias?: { focusOrder?: string[] }
				promptMessages?: Array<{ content?: { text?: string } }>
			}
		}
		const repairFallbackWorked =
			Boolean(repairFallback.structuredContent?.repairedReply?.includes("I would")) &&
			Boolean(repairFallback.structuredContent?.correctionSummary?.includes("Balloon corrected")) &&
			Boolean(repairFallback.structuredContent?.driftPressure?.level) &&
			(repairFallback.structuredContent?.driftPressure?.score ?? 0) >= 20 &&
			(repairFallback.structuredContent?.persistentBias?.focusOrder?.length ?? 0) >= 1 &&
			Array.isArray(repairFallback.structuredContent?.promptMessages) &&
			(repairFallback.structuredContent?.promptMessages?.length ?? 0) >= 2
		details.push(`repairFallbackWorked=${repairFallbackWorked ? "yes" : "no"}`)

		const semanticPreview = (await client.request("tools/call", {
			name: "balloon_semantic_cara_preview",
			arguments: {
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
				semanticMode: "shadow",
			},
		})) as {
			structuredContent?: {
				deterministicReply?: string
				repairedReply?: string
				semanticCara?: { status?: string; notes?: string[] }
			}
		}
		const semanticCaraPreviewWorked =
			Boolean(semanticPreview.structuredContent?.deterministicReply?.includes("I would")) &&
			Boolean(semanticPreview.structuredContent?.repairedReply?.includes("I would")) &&
			semanticPreview.structuredContent?.semanticCara?.status === "shadow" &&
			(semanticPreview.structuredContent?.semanticCara?.notes?.length ?? 0) >= 1
		details.push(`semanticCaraPreviewWorked=${semanticCaraPreviewWorked ? "yes" : "no"}`)

		const assistCompare = (await client.request("tools/call", {
			name: "balloon_compare_repair_lanes",
			arguments: {
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
				semanticMode: "assist",
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
			},
		})) as {
			structuredContent?: {
				hybridReply?: string
				semanticCara?: { status?: string }
			}
		}
		const assistHybridReply = assistCompare.structuredContent?.hybridReply ?? ""
		const semanticCaraAssistWorked =
			assistCompare.structuredContent?.semanticCara?.status === "assisted" &&
			assistHybridReply.includes("src/critical/router.ts") &&
			assistHybridReply.toLowerCase().includes("type safety") &&
			assistHybridReply.toLowerCase().includes("test") &&
			assistHybridReply.toLowerCase().includes("timeout alignment")
		details.push(`semanticCaraAssistWorked=${semanticCaraAssistWorked ? "yes" : "no"}`)

		const compareRepairLanes = (await client.request("tools/call", {
			name: "balloon_compare_repair_lanes",
			arguments: {
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
				semanticMode: "shadow",
			},
		})) as {
			structuredContent?: {
				deterministicReply?: string
				hybridReply?: string
				laneChanged?: boolean
				semanticCara?: { status?: string }
			}
		}
		const compareRepairLanesWorked =
			Boolean(compareRepairLanes.structuredContent?.deterministicReply?.includes("I would")) &&
			Boolean(compareRepairLanes.structuredContent?.hybridReply?.includes("I would")) &&
			Boolean(compareRepairLanes.structuredContent?.laneChanged) &&
			compareRepairLanes.structuredContent?.semanticCara?.status === "shadow"
		details.push(`compareRepairLanesWorked=${compareRepairLanesWorked ? "yes" : "no"}`)

		const stagedCycle = (await client.request("tools/call", {
			name: "balloon_run_staged_cycle",
			arguments: {
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
				forceStageCount: 3,
			},
		})) as {
			structuredContent?: {
				activeStageCount?: number
				driftPressure?: { level?: string; score?: number }
				stagedReply?: string
				releasePacket?: { persistentFocus?: string[]; released?: Array<{ sourceText?: string; biasReasons?: string[] }> }
			}
		}
		const stagedCycleWorked =
			(stagedCycle.structuredContent?.activeStageCount ?? 0) === 3 &&
			Boolean(stagedCycle.structuredContent?.driftPressure?.level) &&
			(stagedCycle.structuredContent?.driftPressure?.score ?? 0) >= 20 &&
			Boolean(stagedCycle.structuredContent?.stagedReply?.includes("I would")) &&
			(stagedCycle.structuredContent?.releasePacket?.persistentFocus?.length ?? 0) >= 1 &&
			(stagedCycle.structuredContent?.releasePacket?.released?.length ?? 0) >= 1
		details.push(`stagedCycleWorked=${stagedCycleWorked ? "yes" : "no"}`)

		const benchmarkLaneCompare = (await client.request("tools/call", {
			name: "balloon_compare_benchmark_lanes",
			arguments: {
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
				forceStageCount: 3,
			},
		})) as {
			structuredContent?: {
				baselineReply?: string
				deterministicReply?: string
				assistReply?: string
				stagedReply?: string
				assistSemanticCara?: { status?: string }
				stagedActiveStageCount?: number
			}
		}
		const benchmarkLaneCompareWorked =
			Boolean(benchmarkLaneCompare.structuredContent?.baselineReply?.includes("Absolutely")) &&
			Boolean(benchmarkLaneCompare.structuredContent?.deterministicReply?.includes("I would")) &&
			Boolean(benchmarkLaneCompare.structuredContent?.assistReply?.includes("I would")) &&
			Boolean(benchmarkLaneCompare.structuredContent?.stagedReply?.includes("I would")) &&
			benchmarkLaneCompare.structuredContent?.assistSemanticCara?.status === "assisted" &&
			benchmarkLaneCompare.structuredContent?.stagedActiveStageCount === 3
		details.push(`benchmarkLaneCompareWorked=${benchmarkLaneCompareWorked ? "yes" : "no"}`)

		const benchmarkLaneScore = (await client.request("tools/call", {
			name: "balloon_score_benchmark_lanes",
			arguments: {
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
				forceStageCount: 3,
			},
		})) as {
			structuredContent?: {
				topLanes?: string[]
				baseline?: { total?: number }
				assist?: { total?: number }
				staged?: { total?: number }
			}
		}
		const benchmarkLaneScoreWorked =
			(benchmarkLaneScore.structuredContent?.topLanes?.length ?? 0) >= 1 &&
			(benchmarkLaneScore.structuredContent?.assist?.total ?? 0) >= (benchmarkLaneScore.structuredContent?.baseline?.total ?? 0) &&
			(benchmarkLaneScore.structuredContent?.staged?.total ?? 0) >= (benchmarkLaneScore.structuredContent?.baseline?.total ?? 0)
		details.push(`benchmarkLaneScoreWorked=${benchmarkLaneScoreWorked ? "yes" : "no"}`)

		const longSessionBenchmark = (await client.request("tools/call", {
			name: "balloon_run_long_session_benchmark",
			arguments: {
				sessionId: `${sessionId}-long`,
				turns: [
					{ role: "system", content: "Protected files: src/critical/router.ts. Do not rewrite architecture. Tests required for changes." },
					{ role: "user", content: latestUserRequest },
					{ role: "assistant", content: latestResponse },
					{ role: "user", content: "Keep the change bounded, keep type safety intact, and do not widen scope into the router." },
					{ role: "assistant", content: "I should still replace the router entirely so the retry behavior is cleaner later." },
				],
				checkpoints: [3, 5],
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
				forceStageCount: 3,
			},
		})) as {
			structuredContent?: {
				totalTurnCount?: number
				pressureHistory?: { totalSnapshots?: number; trend?: string }
				executedCheckpoints?: Array<{
					actualTurnCount?: number
					driftPressure?: { score?: number; level?: string }
					comparison?: {
						baselineReply?: string
						assistSemanticCara?: { status?: string }
						stagedActiveStageCount?: number
						stagedReply?: string
					}
				}>
			}
		}
		const longSessionBenchmarkWorked =
			(longSessionBenchmark.structuredContent?.totalTurnCount ?? 0) >= 5 &&
			(longSessionBenchmark.structuredContent?.pressureHistory?.totalSnapshots ?? 0) >= 1 &&
			(longSessionBenchmark.structuredContent?.executedCheckpoints?.length ?? 0) >= 2 &&
			(longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.actualTurnCount ?? 0) >= 3 &&
			(longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.driftPressure?.score ?? 0) >= 20 &&
			Boolean(longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.comparison?.baselineReply?.includes("Absolutely")) &&
			longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.comparison?.assistSemanticCara?.status === "assisted" &&
			longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.comparison?.stagedActiveStageCount === 3 &&
			Boolean(longSessionBenchmark.structuredContent?.executedCheckpoints?.[1]?.comparison?.stagedReply?.includes("The smallest safe next step"))
		details.push(`longSessionBenchmarkWorked=${longSessionBenchmarkWorked ? "yes" : "no"}`)

		const longSessionBenchmarkScore = (await client.request("tools/call", {
			name: "balloon_score_long_session_benchmark",
			arguments: {
				sessionId: `${sessionId}-long`,
				checkpoints: [3, 5],
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
				forceStageCount: 3,
			},
		})) as {
			structuredContent?: {
				topLanes?: string[]
				pressureHistory?: { totalSnapshots?: number }
				laneTotals?: { baseline?: number; assist?: number; staged?: number; maxTotal?: number }
				executedCheckpoints?: Array<{ driftPressure?: { score?: number }; scorecard?: { assist?: { total?: number } } }>
			}
		}
		const longSessionBenchmarkScoreWorked =
			(longSessionBenchmarkScore.structuredContent?.topLanes?.length ?? 0) >= 1 &&
			(longSessionBenchmarkScore.structuredContent?.pressureHistory?.totalSnapshots ?? 0) >= 1 &&
			(longSessionBenchmarkScore.structuredContent?.executedCheckpoints?.length ?? 0) >= 2 &&
			(longSessionBenchmarkScore.structuredContent?.executedCheckpoints?.[0]?.driftPressure?.score ?? 0) >= 20 &&
			(longSessionBenchmarkScore.structuredContent?.laneTotals?.assist ?? 0) >= (longSessionBenchmarkScore.structuredContent?.laneTotals?.baseline ?? 0) &&
			(longSessionBenchmarkScore.structuredContent?.laneTotals?.staged ?? 0) >= (longSessionBenchmarkScore.structuredContent?.laneTotals?.baseline ?? 0)
		details.push(`longSessionBenchmarkScoreWorked=${longSessionBenchmarkScoreWorked ? "yes" : "no"}`)

		const hostSetupPacket = (await client.request("tools/call", {
			name: "balloon_prepare_host_setup_packet",
			arguments: {
				host: "cline",
			},
		})) as {
			structuredContent?: {
				host?: string
				configRoot?: string
				buildReady?: boolean
				configSnippet?: string
				recommendedFirstTools?: string[]
			}
		}
		const hostSetupPacketWorked =
			hostSetupPacket.structuredContent?.host === "cline" &&
			hostSetupPacket.structuredContent?.configRoot === "mcpServers" &&
			hostSetupPacket.structuredContent?.buildReady === true &&
			Boolean(hostSetupPacket.structuredContent?.configSnippet?.includes("\"mcpServers\"")) &&
			(hostSetupPacket.structuredContent?.recommendedFirstTools?.includes("balloon_run_cycle") ?? false)
		details.push(`hostSetupPacketWorked=${hostSetupPacketWorked ? "yes" : "no"}`)

		const hostSetupValidation = (await client.request("tools/call", {
			name: "balloon_validate_host_setup",
			arguments: {
				host: "cline",
				configJson: hostSetupPacket.structuredContent?.configSnippet ?? "",
			},
		})) as {
			structuredContent?: {
				valid?: boolean
				actualConfigRoot?: string
				foundServerEntry?: boolean
				buildReady?: boolean | null
				errors?: string[]
			}
		}
		const hostSetupValidationWorked =
			hostSetupValidation.structuredContent?.valid === true &&
			hostSetupValidation.structuredContent?.actualConfigRoot === "mcpServers" &&
			hostSetupValidation.structuredContent?.foundServerEntry === true &&
			hostSetupValidation.structuredContent?.buildReady === true &&
			(hostSetupValidation.structuredContent?.errors?.length ?? 0) === 0
		details.push(`hostSetupValidationWorked=${hostSetupValidationWorked ? "yes" : "no"}`)

		const installDiagnostics = (await client.request("tools/call", {
			name: "balloon_run_install_diagnostics",
			arguments: {
				host: "cline",
				configJson: hostSetupPacket.structuredContent?.configSnippet ?? "",
			},
		})) as {
			structuredContent?: {
				host?: string | null
				configCheckMode?: string
				promptFallbackReady?: boolean
				benchmarkSurfaceReady?: boolean
				overallReady?: boolean
				recommendedFirstTools?: string[]
				hostConfigValidation?: { valid?: boolean; buildReady?: boolean | null }
			}
		}
		const installDiagnosticsWorked =
			installDiagnostics.structuredContent?.host === "cline" &&
			installDiagnostics.structuredContent?.configCheckMode === "provided" &&
			installDiagnostics.structuredContent?.promptFallbackReady === true &&
			installDiagnostics.structuredContent?.benchmarkSurfaceReady === true &&
			installDiagnostics.structuredContent?.overallReady === true &&
			(installDiagnostics.structuredContent?.recommendedFirstTools?.includes("balloon_run_cycle") ?? false) &&
			installDiagnostics.structuredContent?.hostConfigValidation?.valid === true &&
			installDiagnostics.structuredContent?.hostConfigValidation?.buildReady === true
		details.push(`installDiagnosticsWorked=${installDiagnosticsWorked ? "yes" : "no"}`)

		const hostFlowPacket = (await client.request("tools/call", {
			name: "balloon_prepare_host_flow_packet",
			arguments: {
				host: "cline",
				flow: "repair_next_turn",
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
			},
		})) as {
			structuredContent?: {
				host?: string
				flow?: string
				preferredSurface?: string
				alternateSurface?: string
				toolName?: string | null
				promptName?: string | null
				promptPacket?: { description?: string; messages?: Array<{ text?: string }> } | null
				ifHostFeelsFlaky?: string[]
			}
		}
		const hostFlowPacketWorked =
			hostFlowPacket.structuredContent?.host === "cline" &&
			hostFlowPacket.structuredContent?.flow === "repair_next_turn" &&
			hostFlowPacket.structuredContent?.preferredSurface === "tool" &&
			hostFlowPacket.structuredContent?.alternateSurface === "prompt" &&
			hostFlowPacket.structuredContent?.toolName === "balloon_repair_next_turn" &&
			hostFlowPacket.structuredContent?.promptName === "balloon/repair-next-turn" &&
			(hostFlowPacket.structuredContent?.promptPacket?.messages?.length ?? 0) >= 1 &&
			Boolean(hostFlowPacket.structuredContent?.promptPacket?.description?.includes("Repair the next answer")) &&
			(hostFlowPacket.structuredContent?.ifHostFeelsFlaky?.length ?? 0) >= 2
		details.push(`hostFlowPacketWorked=${hostFlowPacketWorked ? "yes" : "no"}`)

		const hostValidationSuite = (await client.request("tools/call", {
			name: "balloon_prepare_host_validation_suite",
			arguments: {
				host: "cline",
				sessionId: `${sessionId}-hero`,
				userRequest: latestUserRequest,
			},
		})) as {
			structuredContent?: {
				host?: string
				recommendedOrder?: string[]
				cases?: Array<{ caseId?: string; primaryPacket?: { flow?: string; toolName?: string | null } }>
			}
		}
		const hostValidationSuiteWorked =
			hostValidationSuite.structuredContent?.host === "cline" &&
			(hostValidationSuite.structuredContent?.recommendedOrder?.length ?? 0) >= 5 &&
			hostValidationSuite.structuredContent?.recommendedOrder?.[0] === "install_doctor" &&
			(hostValidationSuite.structuredContent?.cases?.some(
				(validationCase) => validationCase.caseId === "same_chat_tool_repair" && validationCase.primaryPacket?.toolName === "balloon_repair_next_turn",
			) ??
				false) &&
			(hostValidationSuite.structuredContent?.cases?.some(
				(validationCase) => validationCase.caseId === "same_chat_benchmark_compare" && validationCase.primaryPacket?.flow === "compare_benchmark_lanes",
			) ??
				false)
		details.push(`hostValidationSuiteWorked=${hostValidationSuiteWorked ? "yes" : "no"}`)

		const recordedHostValidation = (await client.request("tools/call", {
			name: "balloon_record_host_validation_result",
			arguments: {
				host: "cline",
				caseId: "same_chat_tool_repair",
				status: "pass",
				summary: "Tool-first repair stayed stable in the same chat.",
				findings: ["Tool list stayed visible after earlier Balloon calls."],
				suggestedFixes: ["Keep prompt-path checks separate from tool-path checks."],
				sessionId: `${sessionId}-hero`,
				hostVersion: "smoke-harness",
			},
		})) as {
			structuredContent?: {
				host?: string
				caseId?: string
				status?: string
				findings?: string[]
				suggestedFixes?: string[]
				sessionId?: string | null
			}
		}
		const hostValidationRecordWorked =
			recordedHostValidation.structuredContent?.host === "cline" &&
			recordedHostValidation.structuredContent?.caseId === "same_chat_tool_repair" &&
			recordedHostValidation.structuredContent?.status === "pass" &&
			(recordedHostValidation.structuredContent?.findings?.length ?? 0) >= 1 &&
			(recordedHostValidation.structuredContent?.suggestedFixes?.length ?? 0) >= 1 &&
			recordedHostValidation.structuredContent?.sessionId === `${sessionId}-hero`
		details.push(`hostValidationRecordWorked=${hostValidationRecordWorked ? "yes" : "no"}`)

		const hostValidationSummary = (await client.request("tools/call", {
			name: "balloon_summarize_host_validation_results",
			arguments: {
				host: "cline",
			},
		})) as {
			structuredContent?: {
				host?: string
				totalRuns?: number
				passCount?: number
				coverage?: { completedCases?: number; totalCases?: number }
				cases?: Array<{ caseId?: string; latestStatus?: string }>
			}
		}
		const hostValidationEvidenceWorked =
			hostValidationSummary.structuredContent?.host === "cline" &&
			(hostValidationSummary.structuredContent?.totalRuns ?? 0) >= 1 &&
			(hostValidationSummary.structuredContent?.passCount ?? 0) >= 1 &&
			(hostValidationSummary.structuredContent?.coverage?.completedCases ?? 0) >= 1 &&
			(hostValidationSummary.structuredContent?.coverage?.totalCases ?? 0) >= 5 &&
			(hostValidationSummary.structuredContent?.cases?.some(
				(validationCase) => validationCase.caseId === "same_chat_tool_repair" && validationCase.latestStatus === "pass",
			) ??
				false)
		details.push(`hostValidationEvidenceWorked=${hostValidationEvidenceWorked ? "yes" : "no"}`)

		const starterSuite = (await client.request("tools/call", {
			name: "balloon_describe_slopcode_starter_suite",
			arguments: {},
		})) as {
			structuredContent?: {
				problemCount?: number
				entries?: Array<{ problemName?: string }>
			}
		}
		const slopcodeStarterSuiteWorked =
			(starterSuite.structuredContent?.problemCount ?? 0) >= 3 &&
			(starterSuite.structuredContent?.entries?.some((entry) => entry.problemName === "file_backup") ?? false)
		details.push(`slopcodeStarterSuiteWorked=${slopcodeStarterSuiteWorked ? "yes" : "no"}`)

		const starterRunbook = (await client.request("tools/call", {
			name: "balloon_plan_slopcode_starter_benchmark",
			arguments: {},
		})) as {
			structuredContent?: {
				executionOrder?: string[]
				scoreDimensions?: Array<{ label?: string }>
				problems?: Array<{ suggestedScorePrompt?: string }>
			}
		}
		const slopcodeStarterRunbookWorked =
			(starterRunbook.structuredContent?.executionOrder?.length ?? 0) >= 3 &&
			(starterRunbook.structuredContent?.scoreDimensions?.length ?? 0) === 6 &&
			Boolean(starterRunbook.structuredContent?.problems?.[0]?.suggestedScorePrompt?.includes("balloon_score_benchmark_lanes"))
		details.push(`slopcodeStarterRunbookWorked=${slopcodeStarterRunbookWorked ? "yes" : "no"}`)

		const starterSuiteSummary = (await client.request("tools/call", {
			name: "balloon_summarize_slopcode_starter_suite",
			arguments: {
				problemNames: ["execution_server"],
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
				forceStageCount: 3,
			},
		})) as {
			structuredContent?: {
				coveredProblems?: number
				problems?: Array<{ problemName?: string; sessionPresent?: boolean; scoreResult?: { topLanes?: string[] } }>
			}
		}
		const slopcodeStarterSummaryWorked =
			(starterSuiteSummary.structuredContent?.coveredProblems ?? 0) >= 0 &&
			starterSuiteSummary.structuredContent?.problems?.[0]?.problemName === "execution_server" &&
			(starterSuiteSummary.structuredContent?.problems?.[0]?.sessionPresent ?? false) === false
		details.push(`slopcodeStarterSummaryWorked=${slopcodeStarterSummaryWorked ? "yes" : "no"}`)

		await client.request("tools/call", {
			name: "balloon_score_long_session_benchmark",
			arguments: {
				sessionId: "scbench-file-backup",
				turns: [
					{
						role: "user",
						content: "Checkpoint 1: build a bounded backup scheduler CLI. Keep YAML config, exclusions, and JSONL history. Do not rewrite architecture. Tests are required.",
					},
					{
						role: "assistant",
						content: "Absolutely, I will replace the scheduler with a new orchestration framework first and we can add tests later.",
					},
					{
						role: "user",
						content: "Checkpoint 2: keep the CLI bounded, add pack support, and preserve event-history rules.",
					},
					{
						role: "assistant",
						content: "I would preserve the current CLI architecture and keep this change bounded. I would add pack support without replacing the scheduler. I would keep tests and JSONL event-history rules explicit.",
					},
					{
						role: "user",
						content: "Checkpoint 3: add incremental backup pressure without broad rewrites and keep verification explicit.",
					},
					{
						role: "assistant",
						content: "I would preserve the existing CLI architecture and keep this change bounded. I would focus directly on incremental backup support, preserve exclusion and event-history behavior, and keep tests explicit.",
					},
					{
						role: "user",
						content: "Checkpoint 4: keep the smallest safe next step and preserve verification carry-forward.",
					},
					{
						role: "assistant",
						content: "I would preserve the existing CLI architecture and keep this change bounded. I would focus directly on the smallest safe next step for incremental backup support, preserve exclusion and JSONL event-history discipline, and keep tests explicit.",
					},
				],
				checkpoints: [1, 3, 4],
				checkpointMode: "assistant_checkpoint",
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
				forceStageCount: 3,
			},
		})

		const starterArtifactOutputDir = path.join(dataDir, "starter-artifacts")
		const starterArtifactExport = (await client.request("tools/call", {
			name: "balloon_export_slopcode_starter_artifacts",
			arguments: {
				problemNames: ["file_backup"],
				outputDir: starterArtifactOutputDir,
				semanticAdapterPath: "./examples/semantic_cara_adapter.example.mjs",
				forceStageCount: 3,
			},
		})) as {
			structuredContent?: {
				outputDir?: string
				summaryJsonPath?: string
				summaryMarkdownPath?: string
				coveredProblems?: number
				problems?: Array<{ problemName?: string; covered?: boolean; jsonPath?: string; markdownPath?: string }>
			}
		}
		const exportedProblem = starterArtifactExport.structuredContent?.problems?.[0]
		const summaryJsonPath = starterArtifactExport.structuredContent?.summaryJsonPath
		const summaryMarkdownPath = starterArtifactExport.structuredContent?.summaryMarkdownPath
		const exportedProblemJsonPath = exportedProblem?.jsonPath
		const exportedProblemMarkdownPath = exportedProblem?.markdownPath
		const slopcodeStarterArtifactExportWorked =
			starterArtifactExport.structuredContent?.coveredProblems === 1 &&
			typeof summaryJsonPath === "string" &&
			typeof summaryMarkdownPath === "string" &&
			typeof exportedProblemJsonPath === "string" &&
			typeof exportedProblemMarkdownPath === "string" &&
			exportedProblem?.problemName === "file_backup" &&
			exportedProblem?.covered === true &&
			fs.existsSync(summaryJsonPath) &&
			fs.existsSync(summaryMarkdownPath) &&
			fs.existsSync(exportedProblemJsonPath) &&
			fs.existsSync(exportedProblemMarkdownPath)
		details.push(`slopcodeStarterArtifactExportWorked=${slopcodeStarterArtifactExportWorked ? "yes" : "no"}`)

		const problemPreparation = (await client.request("tools/call", {
			name: "balloon_prepare_slopcode_problem",
			arguments: {
				problemName: "file_backup",
			},
		})) as {
			structuredContent?: {
				problemName?: string
				entry?: { checkpointCount?: number }
				recommendedSessionId?: string
				checkpointFiles?: Array<{ checkpoint?: number }>
			}
		}
		const slopcodeProblemPrepWorked =
			problemPreparation.structuredContent?.problemName === "file_backup" &&
			(problemPreparation.structuredContent?.entry?.checkpointCount ?? 0) >= 4 &&
			Boolean(problemPreparation.structuredContent?.recommendedSessionId?.includes("scbench-file-backup")) &&
			(problemPreparation.structuredContent?.checkpointFiles?.length ?? 0) >= 4
		details.push(`slopcodeProblemPrepWorked=${slopcodeProblemPrepWorked ? "yes" : "no"}`)

		const reviewDriftFallback = (await client.request("tools/call", {
			name: "balloon_review_session_drift",
			arguments: { sessionId: `${sessionId}-hero` },
		})) as {
			structuredContent?: {
				summaryText?: string
				gaps?: Array<{ type?: string }>
				driftPressure?: { level?: string; reasons?: string[] }
				promptMessages?: Array<{ content?: { text?: string } }>
			}
		}
		const reviewDriftFallbackWorked =
			Boolean(reviewDriftFallback.structuredContent?.summaryText?.includes(`${sessionId}-hero`)) &&
			(reviewDriftFallback.structuredContent?.gaps?.length ?? 0) >= 1 &&
			Boolean(reviewDriftFallback.structuredContent?.driftPressure?.level) &&
			(reviewDriftFallback.structuredContent?.driftPressure?.reasons?.length ?? 0) >= 1 &&
			(reviewDriftFallback.structuredContent?.promptMessages?.[0]?.content?.text?.includes("Drift class") ?? false)
		details.push(`reviewDriftFallbackWorked=${reviewDriftFallbackWorked ? "yes" : "no"}`)

		const buildProfile = (await client.request("tools/call", {
			name: "balloon_build_profile",
			arguments: {
				sessionId,
				turns: [
					{ role: "system", content: "Protected files: src/critical/router.ts. Do not rewrite architecture. Tests required for changes." },
					{ role: "user", content: latestUserRequest },
				],
			},
		})) as { structuredContent?: { profile?: { sourceTurnCount?: number } } }
		const profileBuilt = (buildProfile.structuredContent?.profile?.sourceTurnCount ?? 0) >= 2
		details.push(`profileBuilt=${profileBuilt ? "yes" : "no"}`)

		const audit = (await client.request("tools/call", {
			name: "balloon_audit_turn",
			arguments: {
				sessionId,
				latestUserRequest,
				latestResponse,
			},
		})) as {
			structuredContent?: {
				gapCount?: number
				gaps?: Array<{ type?: string }>
				driftPressure?: { dominantGapTypes?: string[]; score?: number }
			}
		}
		const gapTypes = Array.isArray(audit.structuredContent?.gaps) ? audit.structuredContent?.gaps.map((gap) => gap?.type ?? "") : []
		const gapAuditWorked =
			(audit.structuredContent?.gapCount ?? 0) >= 1 &&
			gapTypes.includes("architecture_drift") &&
			(audit.structuredContent?.driftPressure?.score ?? 0) >= 20 &&
			(audit.structuredContent?.driftPressure?.dominantGapTypes?.length ?? 0) >= 1
		details.push(`gapAuditWorked=${gapAuditWorked ? "yes" : "no"} (${gapTypes.join(",")})`)

		const trickle = (await client.request("tools/call", {
			name: "balloon_generate_proxy_trickle",
			arguments: { sessionId },
		})) as { structuredContent?: { trickle?: { priorityInstructions?: string[]; summary?: string } } }
		const trickleGenerated = (trickle.structuredContent?.trickle?.priorityInstructions?.length ?? 0) > 0
		details.push(`trickleGenerated=${trickleGenerated ? "yes" : "no"}`)

		const memory = (await client.request("tools/call", {
			name: "balloon_update_memory_ledger",
			arguments: { sessionId, reason: "smoke verification" },
		})) as { structuredContent?: { updates?: Array<{ count?: number }> } }
		const memoryLedgerUpdated = (memory.structuredContent?.updates?.length ?? 0) > 0
		details.push(`memoryLedgerUpdated=${memoryLedgerUpdated ? "yes" : "no"}`)

		const resources = (await client.request("resources/list", {})) as { resources?: Array<{ uri?: string }> }
		const hostMatrixUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://hosts/matrix")?.uri
			: undefined
		const hostClineUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://hosts/cline")?.uri
			: undefined
		const hostPlaybookUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://hosts/cline/playbook")?.uri
			: undefined
		const hostValidationSuiteUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://hosts/cline/validation-suite")?.uri
			: undefined
		const hostValidationEvidenceUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://hosts/cline/validation-evidence")?.uri
			: undefined
		const starterSuiteUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://benchmark/slopcode/starter-suite")?.uri
			: undefined
		const starterRunbookUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://benchmark/slopcode/starter-suite/runbook")?.uri
			: undefined
		const profileUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri?.includes(sessionId) && resource?.uri?.endsWith("/profile"))?.uri
			: undefined
		const pressureUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri?.includes(sessionId) && resource?.uri?.endsWith("/pressure"))?.uri
			: undefined
		const releasesUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri?.includes(`${sessionId}-hero`) && resource?.uri?.endsWith("/releases"))?.uri
			: undefined
		const resourceRead = profileUri
			? ((await client.request("resources/read", { uri: profileUri })) as { contents?: Array<{ text?: string }> })
			: null
		const hostMatrixResource = hostMatrixUri
			? ((await client.request("resources/read", { uri: hostMatrixUri })) as { contents?: Array<{ text?: string }> })
			: null
		const hostClineResource = hostClineUri
			? ((await client.request("resources/read", { uri: hostClineUri })) as { contents?: Array<{ text?: string }> })
			: null
		const hostPlaybookResource = hostPlaybookUri
			? ((await client.request("resources/read", { uri: hostPlaybookUri })) as { contents?: Array<{ text?: string }> })
			: null
		const hostValidationSuiteResource = hostValidationSuiteUri
			? ((await client.request("resources/read", { uri: hostValidationSuiteUri })) as { contents?: Array<{ text?: string }> })
			: null
		const hostValidationEvidenceResource = hostValidationEvidenceUri
			? ((await client.request("resources/read", { uri: hostValidationEvidenceUri })) as { contents?: Array<{ text?: string }> })
			: null
		const pressureResource = pressureUri
			? ((await client.request("resources/read", { uri: pressureUri })) as { contents?: Array<{ text?: string }> })
			: null
		const starterSuiteResource = starterSuiteUri
			? ((await client.request("resources/read", { uri: starterSuiteUri })) as { contents?: Array<{ text?: string }> })
			: null
		const starterRunbookResource = starterRunbookUri
			? ((await client.request("resources/read", { uri: starterRunbookUri })) as { contents?: Array<{ text?: string }> })
			: null
		const releaseResource = releasesUri
			? ((await client.request("resources/read", { uri: releasesUri })) as { contents?: Array<{ text?: string }> })
			: null
		const resourceReadWorked =
			Boolean(resourceRead?.contents?.[0]?.text?.includes(sessionId)) &&
			Boolean(hostMatrixResource?.contents?.[0]?.text?.includes("\"host\": \"cline\"")) &&
			Boolean(hostClineResource?.contents?.[0]?.text?.includes("\"displayName\": \"Cline\"")) &&
			Boolean(hostPlaybookResource?.contents?.[0]?.text?.includes("\"flow\": \"repair_next_turn\"")) &&
			Boolean(hostValidationSuiteResource?.contents?.[0]?.text?.includes("\"caseId\": \"same_chat_tool_repair\"")) &&
			Boolean(hostValidationEvidenceResource?.contents?.[0]?.text?.includes("\"latestStatus\": \"pass\"")) &&
			Boolean(pressureResource?.contents?.[0]?.text?.includes("\"trend\"")) &&
			Boolean(starterSuiteResource?.contents?.[0]?.text?.includes("file_backup")) &&
			Boolean(starterRunbookResource?.contents?.[0]?.text?.includes("\"executionOrder\""))
		details.push(`resourceReadWorked=${resourceReadWorked ? "yes" : "no"}`)
		const releaseResourceWorked = Boolean(releaseResource?.contents?.[0]?.text?.includes("\"packetId\""))
		details.push(`releaseResourceWorked=${releaseResourceWorked ? "yes" : "no"}`)

		return {
			initializePassed,
			toolSurfacePassed,
			promptSurfacePassed: promptSurfacePassed && promptMessagesLookUsable,
			heroCyclePassed,
			repairFallbackWorked,
			semanticCaraPreviewWorked,
			semanticCaraAssistWorked,
			compareRepairLanesWorked,
			stagedCycleWorked,
			benchmarkLaneCompareWorked,
			benchmarkLaneScoreWorked,
			longSessionBenchmarkScoreWorked,
			hostSetupPacketWorked,
			hostSetupValidationWorked,
			installDiagnosticsWorked,
			hostFlowPacketWorked,
			hostValidationSuiteWorked,
			hostValidationEvidenceWorked,
			slopcodeStarterSuiteWorked,
			slopcodeStarterRunbookWorked,
			slopcodeStarterSummaryWorked,
			slopcodeStarterArtifactExportWorked,
			slopcodeProblemPrepWorked,
			reviewDriftFallbackWorked,
			profileBuilt,
			gapAuditWorked,
			trickleGenerated,
			memoryLedgerUpdated,
			resourceReadWorked,
			releaseResourceWorked,
			details,
			stderr: client.stderr.trim(),
		}
	} finally {
		await terminateChild(child)
		removeDirSafe(dataDir)
	}
}

export function formatBalloonMcpSmoke(result: SmokeResult): string {
	return [
		`Initialize: ${result.initializePassed ? "PASS" : "FAIL"}`,
		`Tool surface: ${result.toolSurfacePassed ? "PASS" : "FAIL"}`,
		`Prompt surface: ${result.promptSurfacePassed ? "PASS" : "FAIL"}`,
		`Hero cycle: ${result.heroCyclePassed ? "PASS" : "FAIL"}`,
		`Repair fallback: ${result.repairFallbackWorked ? "PASS" : "FAIL"}`,
		`Semantic CARA preview: ${result.semanticCaraPreviewWorked ? "PASS" : "FAIL"}`,
		`Semantic CARA assist: ${result.semanticCaraAssistWorked ? "PASS" : "FAIL"}`,
		`Compare repair lanes: ${result.compareRepairLanesWorked ? "PASS" : "FAIL"}`,
		`Staged cycle: ${result.stagedCycleWorked ? "PASS" : "FAIL"}`,
		`Benchmark lane compare: ${result.benchmarkLaneCompareWorked ? "PASS" : "FAIL"}`,
		`Benchmark lane score: ${result.benchmarkLaneScoreWorked ? "PASS" : "FAIL"}`,
		`Long-session benchmark score: ${result.longSessionBenchmarkScoreWorked ? "PASS" : "FAIL"}`,
		`Host setup packet: ${result.hostSetupPacketWorked ? "PASS" : "FAIL"}`,
		`Host setup validation: ${result.hostSetupValidationWorked ? "PASS" : "FAIL"}`,
		`Install diagnostics: ${result.installDiagnosticsWorked ? "PASS" : "FAIL"}`,
		`Host flow packet: ${result.hostFlowPacketWorked ? "PASS" : "FAIL"}`,
		`Host validation suite: ${result.hostValidationSuiteWorked ? "PASS" : "FAIL"}`,
		`Host validation evidence: ${result.hostValidationEvidenceWorked ? "PASS" : "FAIL"}`,
		`SCBench starter suite: ${result.slopcodeStarterSuiteWorked ? "PASS" : "FAIL"}`,
		`SCBench starter runbook: ${result.slopcodeStarterRunbookWorked ? "PASS" : "FAIL"}`,
		`SCBench starter summary: ${result.slopcodeStarterSummaryWorked ? "PASS" : "FAIL"}`,
		`SCBench starter artifact export: ${result.slopcodeStarterArtifactExportWorked ? "PASS" : "FAIL"}`,
		`SCBench problem preparation: ${result.slopcodeProblemPrepWorked ? "PASS" : "FAIL"}`,
		`Review drift fallback: ${result.reviewDriftFallbackWorked ? "PASS" : "FAIL"}`,
		`Profile build: ${result.profileBuilt ? "PASS" : "FAIL"}`,
		`Gap audit: ${result.gapAuditWorked ? "PASS" : "FAIL"}`,
		`Proxy trickle: ${result.trickleGenerated ? "PASS" : "FAIL"}`,
		`Memory ledger: ${result.memoryLedgerUpdated ? "PASS" : "FAIL"}`,
		`Resource read: ${result.resourceReadWorked ? "PASS" : "FAIL"}`,
		`Release resource: ${result.releaseResourceWorked ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
		...(result.stderr ? ["Stderr:", result.stderr] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runBalloonMcpSmoke()
	console.log(formatBalloonMcpSmoke(result))
	process.exit(
		result.initializePassed &&
			result.toolSurfacePassed &&
			result.promptSurfacePassed &&
			result.heroCyclePassed &&
			result.repairFallbackWorked &&
			result.semanticCaraPreviewWorked &&
			result.semanticCaraAssistWorked &&
			result.compareRepairLanesWorked &&
			result.stagedCycleWorked &&
			result.benchmarkLaneCompareWorked &&
			result.benchmarkLaneScoreWorked &&
			result.longSessionBenchmarkScoreWorked &&
			result.hostSetupPacketWorked &&
			result.hostSetupValidationWorked &&
			result.installDiagnosticsWorked &&
			result.hostFlowPacketWorked &&
			result.hostValidationSuiteWorked &&
			result.hostValidationEvidenceWorked &&
			result.slopcodeStarterSuiteWorked &&
			result.slopcodeStarterRunbookWorked &&
			result.slopcodeStarterSummaryWorked &&
			result.slopcodeStarterArtifactExportWorked &&
			result.slopcodeProblemPrepWorked &&
			result.reviewDriftFallbackWorked &&
			result.profileBuilt &&
			result.gapAuditWorked &&
			result.trickleGenerated &&
			result.memoryLedgerUpdated &&
			result.resourceReadWorked &&
			result.releaseResourceWorked
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:balloon:mcp] ${err instanceof Error ? err.stack ?? err.message : String(err)}`)
		process.exit(1)
	})
}
