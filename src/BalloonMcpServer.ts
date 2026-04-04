import { BalloonStateStore } from "./BalloonStateStore"
import { getBalloonPrompt, listBalloonPrompts } from "./BalloonPrompts"
import { BalloonToolRegistry, listBalloonResources, readBalloonResource, type JsonValue } from "./BalloonTools"

type JsonRpcId = string | number | null

type JsonRpcRequest = {
	jsonrpc?: unknown
	id?: unknown
	method?: unknown
	params?: unknown
}

type JsonRpcResponse = {
	jsonrpc: "2.0"
	id: JsonRpcId
	result?: JsonValue | Record<string, unknown>
	error?: {
		code: number
		message: string
		data?: JsonValue | Record<string, unknown>
	}
}

type JsonRpcErrorCode =
	| -32700
	| -32600
	| -32601
	| -32602
	| -32603
	| -32000
	| -32001
	| -32002

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asMethod(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asJsonRpcId(value: unknown): JsonRpcId | undefined {
	if (typeof value === "string" || typeof value === "number" || value === null) return value
	return undefined
}

function normalizeToolArgs(value: unknown): Record<string, unknown> {
	const record = asRecord(value)
	return record ?? {}
}

function buildResponse(id: JsonRpcId, payload: Pick<JsonRpcResponse, "result" | "error">): JsonRpcResponse {
	return {
		jsonrpc: "2.0",
		id,
		...payload,
	}
}

export class BalloonMcpServer {
	private readonly store: BalloonStateStore
	private readonly registry: BalloonToolRegistry
	private readonly input: NodeJS.ReadStream
	private readonly output: NodeJS.WriteStream
	private readonly log: NodeJS.WriteStream
	private readonly serverInfo = {
		name: "balloon-mcp-server",
		title: "Balloon MCP Server",
		version: "0.1.0-alpha.0",
	}

	private buffer = Buffer.alloc(0)
	private initialized = false
	private started = false
	private transportMode: "unknown" | "content-length" | "newline" = "unknown"

	constructor(
		store: BalloonStateStore,
		options?: {
			input?: NodeJS.ReadStream
			output?: NodeJS.WriteStream
			log?: NodeJS.WriteStream
		},
	) {
		this.store = store
		this.registry = new BalloonToolRegistry(store)
		this.input = options?.input ?? process.stdin
		this.output = options?.output ?? process.stdout
		this.log = options?.log ?? process.stderr
	}

	start(): void {
		if (this.started) return
		this.started = true
		this.input.on("data", this.handleData)
		this.input.on("end", this.handleEnd)
		this.input.resume()
	}

	stop(): void {
		if (!this.started) return
		this.started = false
		this.input.off("data", this.handleData)
		this.input.off("end", this.handleEnd)
	}

	private readonly handleData = (chunk: Buffer | string): void => {
		const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")
		this.buffer = Buffer.concat([this.buffer, incoming])
		this.consumeBuffer()
	}

	private readonly handleEnd = (): void => {
		this.stop()
	}

	private consumeBuffer(): void {
		while (true) {
			const mode = this.detectTransportMode()
			if (mode === "content-length") {
				if (!this.consumeContentLengthFrame()) return
				continue
			}
			if (mode === "newline") {
				if (!this.consumeNewlineFrame()) return
				continue
			}
			return
		}
	}

	private detectTransportMode(): "unknown" | "content-length" | "newline" {
		if (this.transportMode !== "unknown") return this.transportMode
		const preview = this.buffer.toString("utf8", 0, Math.min(this.buffer.length, 64)).trimStart()
		if (preview.length === 0) return "unknown"
		if (/^content-length\s*:/iu.test(preview)) {
			this.transportMode = "content-length"
			return this.transportMode
		}
		if (preview.startsWith("{") || preview.startsWith("[")) {
			this.transportMode = "newline"
			return this.transportMode
		}
		return "unknown"
	}

	private consumeContentLengthFrame(): boolean {
		const headerEnd = this.findContentLengthHeaderEnd()
		if (headerEnd === -1) return false
		const separatorLength = this.buffer.subarray(headerEnd, headerEnd + 4).toString("utf8").startsWith("\r\n\r\n") ? 4 : 2
		const headerText = this.buffer.subarray(0, headerEnd).toString("utf8")
		const contentLength = this.parseContentLength(headerText)
		if (contentLength === null) {
			this.log.write("[balloon-mcp] ignoring frame without Content-Length\n")
			this.buffer = this.buffer.subarray(headerEnd + separatorLength)
			return true
		}
		const frameLength = headerEnd + separatorLength + contentLength
		if (this.buffer.length < frameLength) return false
		const body = this.buffer.subarray(headerEnd + separatorLength, frameLength).toString("utf8")
		this.buffer = this.buffer.subarray(frameLength)
		this.handleBody(body)
		return true
	}

	private consumeNewlineFrame(): boolean {
		const newlineIndex = this.buffer.indexOf("\n")
		if (newlineIndex === -1) return false
		const line = this.buffer.subarray(0, newlineIndex).toString("utf8").replace(/\r$/u, "").trim()
		this.buffer = this.buffer.subarray(newlineIndex + 1)
		if (line.length === 0) return true
		this.handleBody(line)
		return true
	}

	private findContentLengthHeaderEnd(): number {
		const crlfIndex = this.buffer.indexOf("\r\n\r\n")
		if (crlfIndex !== -1) return crlfIndex
		return this.buffer.indexOf("\n\n")
	}

	private parseContentLength(headerText: string): number | null {
		for (const line of headerText.split(/\r?\n/g)) {
			const match = /^content-length:\s*(\d+)\s*$/iu.exec(line)
			if (match) return Number.parseInt(match[1] ?? "0", 10)
		}
		return null
	}

	private handleBody(body: string): void {
		let parsed: unknown
		try {
			parsed = JSON.parse(body)
		} catch (err) {
			this.sendError(null, -32700, "Parse error", { detail: err instanceof Error ? err.message : String(err) })
			return
		}

		if (Array.isArray(parsed)) {
			this.sendError(null, -32600, "Batch requests are not supported by this server.")
			return
		}

		const request = asRecord(parsed) as JsonRpcRequest | null
		if (!request) {
			this.sendError(null, -32600, "Invalid request.")
			return
		}

		const method = asMethod(request.method)
		const id = asJsonRpcId(request.id)
		if (!method) {
			this.sendError(id ?? null, -32600, "Invalid request: method is required.")
			return
		}

		try {
			this.dispatch(method, request.params, id)
		} catch (err) {
			this.sendError(id ?? null, -32603, "Internal error", { detail: err instanceof Error ? err.message : String(err) })
		}
	}

	private dispatch(method: string, params: unknown, id: JsonRpcId | undefined): void {
		switch (method) {
			case "initialize":
				this.initialized = true
				this.sendResult(id ?? null, {
					protocolVersion: "2025-06-18",
					capabilities: {
						tools: { listChanged: false },
						resources: { listChanged: false },
						prompts: { listChanged: false },
					},
					serverInfo: this.serverInfo,
				})
				return
			case "notifications/initialized":
				this.initialized = true
				return
			case "ping":
				if (id !== undefined) this.sendResult(id, {})
				return
			case "tools/list":
				if (!this.ensureInitialized(id)) return
				this.sendResult(id ?? null, { tools: this.registry.listTools() })
				return
			case "tools/call":
				if (!this.ensureInitialized(id)) return
				this.handleToolCall(params, id)
				return
			case "resources/list":
				if (!this.ensureInitialized(id)) return
				this.sendResult(id ?? null, { resources: listBalloonResources(this.store) })
				return
			case "resources/read":
				if (!this.ensureInitialized(id)) return
				this.handleResourceRead(params, id)
				return
			case "prompts/list":
				if (!this.ensureInitialized(id)) return
				this.sendResult(id ?? null, { prompts: listBalloonPrompts() })
				return
			case "prompts/get":
				if (!this.ensureInitialized(id)) return
				this.handlePromptGet(params, id)
				return
			default:
				if (id !== undefined) this.sendError(id, -32601, `Method not found: ${method}`)
		}
	}

	private ensureInitialized(id: JsonRpcId | undefined): boolean {
		if (this.initialized) return true
		if (id !== undefined) this.sendError(id, -32001, "Server not initialized.")
		return false
	}

	private handleToolCall(params: unknown, id: JsonRpcId | undefined): void {
		const record = asRecord(params)
		if (!record) {
			this.sendError(id ?? null, -32602, "tools/call params must be an object.")
			return
		}
		const name = asMethod(record.name)
		if (!name) {
			this.sendError(id ?? null, -32602, "tools/call requires a tool name.")
			return
		}
		const args = normalizeToolArgs(record.arguments)
		const result = this.registry.callTool(name, args)
		this.sendResult(id ?? null, result)
	}

	private handleResourceRead(params: unknown, id: JsonRpcId | undefined): void {
		const record = asRecord(params)
		const uri = record && typeof record.uri === "string" ? record.uri : null
		if (!uri) {
			this.sendError(id ?? null, -32602, "resources/read requires a uri.")
			return
		}
		const content = readBalloonResource(this.store, uri)
		if (!content) {
			this.sendError(id ?? null, -32002, `Resource not found: ${uri}`)
			return
		}
		this.sendResult(id ?? null, { contents: [content] })
	}

	private handlePromptGet(params: unknown, id: JsonRpcId | undefined): void {
		const record = asRecord(params)
		if (!record) {
			this.sendError(id ?? null, -32602, "prompts/get params must be an object.")
			return
		}
		const name = asMethod(record.name)
		if (!name) {
			this.sendError(id ?? null, -32602, "prompts/get requires a prompt name.")
			return
		}
		const args = normalizeToolArgs(record.arguments)
		const prompt = getBalloonPrompt(this.store, name, args)
		if (!prompt) {
			this.sendError(id ?? null, -32002, `Prompt not found or missing required arguments: ${name}`)
			return
		}
		this.sendResult(id ?? null, {
			description: prompt.description,
			messages: prompt.messages,
		})
	}

	private sendResult(id: JsonRpcId, result: JsonValue | Record<string, unknown>): void {
		this.writeMessage(buildResponse(id, { result }))
	}

	private sendError(id: JsonRpcId, code: JsonRpcErrorCode, message: string, data?: JsonValue | Record<string, unknown>): void {
		this.writeMessage(
			buildResponse(id, {
				error: { code, message, data },
			}),
		)
	}

	private writeMessage(message: JsonRpcResponse): void {
		const serialized = JSON.stringify(message)
		if (this.transportMode === "newline") {
			this.output.write(`${serialized}\n`, "utf8")
			return
		}
		const frame = `Content-Length: ${Buffer.byteLength(serialized, "utf8")}\r\n\r\n${serialized}`
		this.output.write(frame, "utf8")
	}
}
