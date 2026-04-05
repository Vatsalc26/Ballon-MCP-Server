import minimist from "minimist"
import { BalloonMcpServer } from "./BalloonMcpServer"
import { BalloonStateStore, createDefaultBalloonDbPath } from "./BalloonStateStore"

let keepAliveTimer: NodeJS.Timeout | null = null

function closeAndExit(store: BalloonStateStore, code: number): never {
	if (keepAliveTimer) {
		clearInterval(keepAliveTimer)
		keepAliveTimer = null
	}
	try {
		store.close()
	} catch {
		// ignore close failures during shutdown
	}
	process.exit(code)
}

async function main(): Promise<void> {
	const argv = minimist(process.argv.slice(2), {
		string: ["data-dir", "semantic-cara-mode", "semantic-cara-adapter", "semantic-cara-timeout-ms", "semantic-cara-max-notes"],
	})

	const dataDir = typeof argv["data-dir"] === "string" ? argv["data-dir"] : undefined
	const semanticCaraMode = typeof argv["semantic-cara-mode"] === "string" ? argv["semantic-cara-mode"] : undefined
	const semanticCaraAdapter = typeof argv["semantic-cara-adapter"] === "string" ? argv["semantic-cara-adapter"] : undefined
	const semanticCaraTimeoutMs = typeof argv["semantic-cara-timeout-ms"] === "string" ? argv["semantic-cara-timeout-ms"] : undefined
	const semanticCaraMaxNotes = typeof argv["semantic-cara-max-notes"] === "string" ? argv["semantic-cara-max-notes"] : undefined
	if (semanticCaraMode) process.env.BALLOON_SEMANTIC_CARA_MODE = semanticCaraMode
	if (semanticCaraAdapter) process.env.BALLOON_SEMANTIC_CARA_ADAPTER = semanticCaraAdapter
	if (semanticCaraTimeoutMs) process.env.BALLOON_SEMANTIC_CARA_TIMEOUT_MS = semanticCaraTimeoutMs
	if (semanticCaraMaxNotes) process.env.BALLOON_SEMANTIC_CARA_MAX_NOTES = semanticCaraMaxNotes
	const dbPath = createDefaultBalloonDbPath(process.cwd(), dataDir)
	const store = new BalloonStateStore(dbPath)
	const server = new BalloonMcpServer(store)

	process.on("SIGINT", () => closeAndExit(store, 0))
	process.on("SIGTERM", () => closeAndExit(store, 0))
	process.on("uncaughtException", (err) => {
		process.stderr.write(`[balloon-mcp] uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
		closeAndExit(store, 1)
	})

	server.start()
	// Keep the stdio server process alive between requests in standalone repo mode.
	keepAliveTimer = setInterval(() => {
		// intentional no-op
	}, 60_000)
}

if (require.main === module) {
	void main().catch((err) => {
		process.stderr.write(`[balloon-mcp] failed to start: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`)
		process.exit(1)
	})
}
