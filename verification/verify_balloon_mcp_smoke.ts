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
	profileBuilt: boolean
	gapAuditWorked: boolean
	trickleGenerated: boolean
	memoryLedgerUpdated: boolean
	resourceReadWorked: boolean
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
			hasTool(toolsList, "balloon_generate_proxy_trickle")
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
		const profileUri = Array.isArray(resources.resources) ? resources.resources.find((resource) => resource?.uri?.endsWith("/profile"))?.uri : undefined
		const resourceRead = profileUri
			? ((await client.request("resources/read", { uri: profileUri })) as { contents?: Array<{ text?: string }> })
			: null
		const resourceReadWorked = Boolean(resourceRead?.contents?.[0]?.text?.includes(sessionId))
		details.push(`resourceReadWorked=${resourceReadWorked ? "yes" : "no"}`)

		return {
			initializePassed,
			toolSurfacePassed,
			promptSurfacePassed: promptSurfacePassed && promptMessagesLookUsable,
			heroCyclePassed,
			profileBuilt,
			gapAuditWorked,
			trickleGenerated,
			memoryLedgerUpdated,
			resourceReadWorked,
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
		`Profile build: ${result.profileBuilt ? "PASS" : "FAIL"}`,
		`Gap audit: ${result.gapAuditWorked ? "PASS" : "FAIL"}`,
		`Proxy trickle: ${result.trickleGenerated ? "PASS" : "FAIL"}`,
		`Memory ledger: ${result.memoryLedgerUpdated ? "PASS" : "FAIL"}`,
		`Resource read: ${result.resourceReadWorked ? "PASS" : "FAIL"}`,
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
			result.profileBuilt &&
			result.gapAuditWorked &&
			result.trickleGenerated &&
			result.memoryLedgerUpdated &&
			result.resourceReadWorked
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
