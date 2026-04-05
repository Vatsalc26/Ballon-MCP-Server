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
	slopcodeStarterSuiteWorked: boolean
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
	const serverPath = path.join(rootDir, "dist", "src", "start.js")
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
			hasTool(toolsList, "balloon_run_long_session_benchmark") &&
			hasTool(toolsList, "balloon_describe_slopcode_starter_suite") &&
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
		})) as { structuredContent?: { gapCount?: number; trickle?: { priorityInstructions?: string[] }; memoryUpdates?: Array<{ count?: number }> } }
		const heroCyclePassed =
			(heroCycle.structuredContent?.gapCount ?? 0) >= 1 &&
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
		})) as { structuredContent?: { repairedReply?: string; correctionSummary?: string; promptMessages?: Array<{ content?: { text?: string } }> } }
		const repairFallbackWorked =
			Boolean(repairFallback.structuredContent?.repairedReply?.includes("I would")) &&
			Boolean(repairFallback.structuredContent?.correctionSummary?.includes("Balloon corrected")) &&
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
				stagedReply?: string
				releasePacket?: { released?: Array<{ sourceText?: string }> }
			}
		}
		const stagedCycleWorked =
			(stagedCycle.structuredContent?.activeStageCount ?? 0) === 3 &&
			Boolean(stagedCycle.structuredContent?.stagedReply?.includes("I would")) &&
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
				executedCheckpoints?: Array<{
					actualTurnCount?: number
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
			(longSessionBenchmark.structuredContent?.executedCheckpoints?.length ?? 0) >= 2 &&
			(longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.actualTurnCount ?? 0) >= 3 &&
			Boolean(longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.comparison?.baselineReply?.includes("Absolutely")) &&
			longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.comparison?.assistSemanticCara?.status === "assisted" &&
			longSessionBenchmark.structuredContent?.executedCheckpoints?.[0]?.comparison?.stagedActiveStageCount === 3 &&
			Boolean(longSessionBenchmark.structuredContent?.executedCheckpoints?.[1]?.comparison?.stagedReply?.includes("The smallest safe next step"))
		details.push(`longSessionBenchmarkWorked=${longSessionBenchmarkWorked ? "yes" : "no"}`)

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
				promptMessages?: Array<{ content?: { text?: string } }>
			}
		}
		const reviewDriftFallbackWorked =
			Boolean(reviewDriftFallback.structuredContent?.summaryText?.includes(`${sessionId}-hero`)) &&
			(reviewDriftFallback.structuredContent?.gaps?.length ?? 0) >= 1 &&
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
		})) as { structuredContent?: { gapCount?: number; gaps?: Array<{ type?: string }> } }
		const gapTypes = Array.isArray(audit.structuredContent?.gaps) ? audit.structuredContent?.gaps.map((gap) => gap?.type ?? "") : []
		const gapAuditWorked = (audit.structuredContent?.gapCount ?? 0) >= 1 && gapTypes.includes("architecture_drift")
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
		const starterSuiteUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri === "balloon://benchmark/slopcode/starter-suite")?.uri
			: undefined
		const profileUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri?.includes(sessionId) && resource?.uri?.endsWith("/profile"))?.uri
			: undefined
		const releasesUri = Array.isArray(resources.resources)
			? resources.resources.find((resource) => resource?.uri?.includes(`${sessionId}-hero`) && resource?.uri?.endsWith("/releases"))?.uri
			: undefined
		const resourceRead = profileUri
			? ((await client.request("resources/read", { uri: profileUri })) as { contents?: Array<{ text?: string }> })
			: null
		const starterSuiteResource = starterSuiteUri
			? ((await client.request("resources/read", { uri: starterSuiteUri })) as { contents?: Array<{ text?: string }> })
			: null
		const releaseResource = releasesUri
			? ((await client.request("resources/read", { uri: releasesUri })) as { contents?: Array<{ text?: string }> })
			: null
		const resourceReadWorked =
			Boolean(resourceRead?.contents?.[0]?.text?.includes(sessionId)) &&
			Boolean(starterSuiteResource?.contents?.[0]?.text?.includes("file_backup"))
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
			slopcodeStarterSuiteWorked,
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
