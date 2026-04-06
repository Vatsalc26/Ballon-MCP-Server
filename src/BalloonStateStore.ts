import fs from "fs"
import path from "path"
import crypto from "crypto"
import type {
	BalloonGap,
	BalloonHostKind,
	BalloonDriftPressureSnapshot,
	BalloonHostValidationEvidence,
	BalloonSessionSummary,
	BalloonTurn,
	MemoryLedgerItem,
	ProxyTrickle,
	ReleasePacket,
	StructuredProfile,
} from "./types"

type DbRunResult = {
	changes: number
	lastInsertRowid: number | bigint
}

type StatementLike = {
	run: (...params: unknown[]) => DbRunResult
	get: (...params: unknown[]) => unknown
	all: (...params: unknown[]) => unknown[]
}

type DatabaseLike = {
	exec: (sql: string) => void
	prepare: (sql: string) => StatementLike
	close: () => void
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS balloon_sessions (
	session_id TEXT PRIMARY KEY,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balloon_turns (
	turn_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	turn_order INTEGER NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balloon_turns_session_order
	ON balloon_turns(session_id, turn_order);

CREATE TABLE IF NOT EXISTS balloon_profiles (
	session_id TEXT PRIMARY KEY,
	profile_json TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balloon_gaps (
	gap_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	gap_type TEXT NOT NULL,
	severity TEXT NOT NULL,
	title TEXT NOT NULL,
	details_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balloon_gaps_session_created
	ON balloon_gaps(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS balloon_trickles (
	trickle_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	trickle_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balloon_trickles_session_created
	ON balloon_trickles(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS balloon_memory_ledger (
	session_id TEXT NOT NULL,
	item_key TEXT NOT NULL,
	item_text TEXT NOT NULL,
	count INTEGER NOT NULL,
	last_reason TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (session_id, item_key)
);

CREATE TABLE IF NOT EXISTS balloon_releases (
	packet_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	packet_json TEXT NOT NULL,
	created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balloon_releases_session_created
	ON balloon_releases(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS balloon_pressure_snapshots (
	snapshot_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	source TEXT NOT NULL,
	pressure_json TEXT NOT NULL,
	recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balloon_pressure_session_recorded
	ON balloon_pressure_snapshots(session_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS balloon_host_validation_runs (
	run_id TEXT PRIMARY KEY,
	host TEXT NOT NULL,
	case_id TEXT NOT NULL,
	evidence_json TEXT NOT NULL,
	recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_balloon_host_validation_host_recorded
	ON balloon_host_validation_runs(host, recorded_at DESC);
`

type SessionRow = {
	session_id: string
	created_at: string
	updated_at: string
}

type TurnRow = {
	turn_id: string
	role: string
	content: string
	created_at: string
}

type ProfileRow = {
	profile_json: string
}

type GapRow = {
	details_json: string
}

type TrickleRow = {
	trickle_json: string
}

type MemoryRow = {
	item_key: string
	item_text: string
	count: number
	last_reason: string
	updated_at: string
}

type ReleaseRow = {
	packet_json: string
}

type HostValidationRow = {
	evidence_json: string
}

type PressureSnapshotRow = {
	pressure_json: string
}

type CountRow = {
	count: number
}

function openDatabase(dbPath: string): DatabaseLike {
	const errors: string[] = []

	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const BetterSqlite3 = require("better-sqlite3") as new (file: string) => DatabaseLike & { pragma?: (pragma: string) => void }
		return new BetterSqlite3(dbPath)
	} catch (err) {
		errors.push(`better-sqlite3: ${err instanceof Error ? err.message : String(err)}`)
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const NodeSqlite = require("node:sqlite") as { DatabaseSync: new (file: string) => DatabaseLike }
		return new NodeSqlite.DatabaseSync(dbPath)
	} catch (err) {
		errors.push(`node:sqlite: ${err instanceof Error ? err.message : String(err)}`)
	}

	throw new Error(`BalloonStateStore: failed to open sqlite database.\n${errors.join("\n")}`)
}

function applyPragmas(db: DatabaseLike): void {
	const anyDb = db as unknown as { pragma?: (pragma: string) => void }
	const setPragma = (pragma: string) => {
		if (typeof anyDb.pragma === "function") {
			anyDb.pragma(pragma)
			return
		}
		db.exec(`PRAGMA ${pragma}`)
	}

	setPragma("journal_mode = WAL")
	setPragma("busy_timeout = 5000")
	setPragma("foreign_keys = ON")
}

function nowIso(): string {
	return new Date().toISOString()
}

function makeId(prefix: string): string {
	return `${prefix}-${crypto.randomUUID()}`
}

export class BalloonStateStore {
	private readonly db: DatabaseLike

	constructor(dbPath: string) {
		const dir = path.dirname(dbPath)
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
		this.db = openDatabase(dbPath)
		applyPragmas(this.db)
		this.db.exec(SCHEMA_SQL)
	}

	close(): void {
		this.db.close()
	}

	ensureSession(sessionId: string, timestamp = nowIso()): void {
		const existing = this.db.prepare("SELECT session_id FROM balloon_sessions WHERE session_id = ?").get(sessionId)
		if (!existing) {
			this.db.prepare("INSERT INTO balloon_sessions (session_id, created_at, updated_at) VALUES (?, ?, ?)").run(sessionId, timestamp, timestamp)
			return
		}
		this.touchSession(sessionId, timestamp)
	}

	touchSession(sessionId: string, timestamp = nowIso()): void {
		this.db.prepare("UPDATE balloon_sessions SET updated_at = ? WHERE session_id = ?").run(timestamp, sessionId)
	}

	listSessionIds(): string[] {
		const rows = this.db.prepare("SELECT session_id FROM balloon_sessions ORDER BY updated_at DESC").all() as Array<{ session_id: string }>
		return rows.map((row) => row.session_id)
	}

	replaceTurns(sessionId: string, turns: Array<{ role: string; content: string; timestamp?: string }>, timestamp = nowIso()): BalloonTurn[] {
		this.ensureSession(sessionId, timestamp)
		this.db.prepare("DELETE FROM balloon_turns WHERE session_id = ?").run(sessionId)
		return this.appendTurns(sessionId, turns, timestamp, 0)
	}

	appendTurns(
		sessionId: string,
		turns: Array<{ role: string; content: string; timestamp?: string }>,
		timestamp = nowIso(),
		startOrder?: number,
	): BalloonTurn[] {
		this.ensureSession(sessionId, timestamp)
		const currentMax = this.db.prepare("SELECT COALESCE(MAX(turn_order), 0) AS max_order FROM balloon_turns WHERE session_id = ?").get(sessionId) as
			| { max_order?: number }
			| undefined
		let nextOrder = typeof startOrder === "number" ? startOrder : Number(currentMax?.max_order ?? 0)
		const created: BalloonTurn[] = []
		for (const turn of turns) {
			const content = typeof turn.content === "string" ? turn.content.trim() : ""
			const role = typeof turn.role === "string" ? turn.role.trim().toLowerCase() : ""
			if (!content || (role !== "user" && role !== "assistant" && role !== "system")) continue
			nextOrder += 1
			const turnId = makeId("turn")
			const createdAt = typeof turn.timestamp === "string" && turn.timestamp.trim() ? turn.timestamp.trim() : timestamp
			this.db
				.prepare(
					"INSERT INTO balloon_turns (turn_id, session_id, turn_order, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				)
				.run(turnId, sessionId, nextOrder, role, content, createdAt)
			created.push({
				turnId,
				role: role as BalloonTurn["role"],
				content,
				timestamp: createdAt,
			})
		}
		this.touchSession(sessionId, timestamp)
		return created
	}

	getTurns(sessionId: string, limit = 200): BalloonTurn[] {
		const rows = this.db
			.prepare("SELECT turn_id, role, content, created_at FROM balloon_turns WHERE session_id = ? ORDER BY turn_order ASC LIMIT ?")
			.all(sessionId, limit) as TurnRow[]
		return rows.map((row) => ({
			turnId: row.turn_id,
			role: (row.role === "assistant" || row.role === "system" ? row.role : "user") as BalloonTurn["role"],
			content: row.content,
			timestamp: row.created_at,
		}))
	}

	saveProfile(profile: StructuredProfile): void {
		this.ensureSession(profile.sessionId, profile.updatedAt)
		this.db
			.prepare(
				"INSERT INTO balloon_profiles (session_id, profile_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at = excluded.updated_at",
			)
			.run(profile.sessionId, JSON.stringify(profile), profile.updatedAt)
		this.touchSession(profile.sessionId, profile.updatedAt)
	}

	getProfile(sessionId: string): StructuredProfile | null {
		const row = this.db.prepare("SELECT profile_json FROM balloon_profiles WHERE session_id = ?").get(sessionId) as ProfileRow | undefined
		if (!row) return null
		try {
			return JSON.parse(row.profile_json) as StructuredProfile
		} catch {
			return null
		}
	}

	saveGaps(sessionId: string, gaps: BalloonGap[]): void {
		if (gaps.length === 0) {
			this.ensureSession(sessionId)
			return
		}
		for (const gap of gaps) {
			this.db
				.prepare("INSERT INTO balloon_gaps (gap_id, session_id, gap_type, severity, title, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
				.run(gap.gapId, sessionId, gap.type, gap.severity, gap.title, JSON.stringify(gap), gap.createdAt)
		}
		this.touchSession(sessionId, gaps[gaps.length - 1]?.createdAt ?? nowIso())
	}

	getRecentGaps(sessionId: string, limit = 20): BalloonGap[] {
		const rows = this.db
			.prepare("SELECT details_json FROM balloon_gaps WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
			.all(sessionId, limit) as GapRow[]
		return rows
			.map((row) => {
				try {
					return JSON.parse(row.details_json) as BalloonGap
				} catch {
					return null
				}
			})
			.filter((row): row is BalloonGap => row !== null)
	}

	getGapsByIds(sessionId: string, gapIds: string[]): BalloonGap[] {
		if (gapIds.length === 0) return []
		const placeholders = gapIds.map(() => "?").join(", ")
		const rows = this.db
			.prepare(`SELECT details_json FROM balloon_gaps WHERE session_id = ? AND gap_id IN (${placeholders}) ORDER BY created_at DESC`)
			.all(sessionId, ...gapIds) as GapRow[]
		return rows
			.map((row) => {
				try {
					return JSON.parse(row.details_json) as BalloonGap
				} catch {
					return null
				}
			})
			.filter((row): row is BalloonGap => row !== null)
	}

	saveTrickle(trickle: ProxyTrickle): void {
		this.ensureSession(trickle.sessionId, trickle.createdAt)
		this.db
			.prepare("INSERT INTO balloon_trickles (trickle_id, session_id, trickle_json, created_at) VALUES (?, ?, ?, ?)")
			.run(trickle.trickleId, trickle.sessionId, JSON.stringify(trickle), trickle.createdAt)
		this.touchSession(trickle.sessionId, trickle.createdAt)
	}

	getRecentTrickles(sessionId: string, limit = 10): ProxyTrickle[] {
		const rows = this.db
			.prepare("SELECT trickle_json FROM balloon_trickles WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
			.all(sessionId, limit) as TrickleRow[]
		return rows
			.map((row) => {
				try {
					return JSON.parse(row.trickle_json) as ProxyTrickle
				} catch {
					return null
				}
			})
			.filter((row): row is ProxyTrickle => row !== null)
	}

	reinforceMemory(sessionId: string, items: string[], reason: string, timestamp = nowIso()): MemoryLedgerItem[] {
		this.ensureSession(sessionId, timestamp)
		const created: MemoryLedgerItem[] = []
		for (const rawItem of items) {
			const itemText = rawItem.trim()
			if (!itemText) continue
			const itemKey = itemText.toLowerCase()
			const row = this.db.prepare("SELECT count FROM balloon_memory_ledger WHERE session_id = ? AND item_key = ?").get(sessionId, itemKey) as
				| { count?: number }
				| undefined
			const count = Number(row?.count ?? 0) + 1
			this.db
				.prepare(
					"INSERT INTO balloon_memory_ledger (session_id, item_key, item_text, count, last_reason, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, item_key) DO UPDATE SET item_text = excluded.item_text, count = excluded.count, last_reason = excluded.last_reason, updated_at = excluded.updated_at",
				)
				.run(sessionId, itemKey, itemText, count, reason, timestamp)
			created.push({
				itemKey,
				itemText,
				count,
				status: count >= 3 ? "solidified" : count >= 2 ? "reinforced" : "observed",
				lastReason: reason,
				updatedAt: timestamp,
			})
		}
		this.touchSession(sessionId, timestamp)
		return created
	}

	getMemoryLedger(sessionId: string): MemoryLedgerItem[] {
		const rows = this.db
			.prepare(
				"SELECT item_key, item_text, count, last_reason, updated_at FROM balloon_memory_ledger WHERE session_id = ? ORDER BY count DESC, updated_at DESC",
			)
			.all(sessionId) as MemoryRow[]
		return rows.map((row) => ({
			itemKey: row.item_key,
			itemText: row.item_text,
			count: Number(row.count),
			status: Number(row.count) >= 3 ? "solidified" : Number(row.count) >= 2 ? "reinforced" : "observed",
			lastReason: row.last_reason,
			updatedAt: row.updated_at,
		}))
	}

	saveReleasePacket(packet: ReleasePacket): void {
		this.ensureSession(packet.sessionId, packet.createdAt)
		this.db
			.prepare("INSERT INTO balloon_releases (packet_id, session_id, packet_json, created_at) VALUES (?, ?, ?, ?)")
			.run(packet.packetId, packet.sessionId, JSON.stringify(packet), packet.createdAt)
		this.touchSession(packet.sessionId, packet.createdAt)
	}

	getRecentReleasePackets(sessionId: string, limit = 10): ReleasePacket[] {
		const rows = this.db
			.prepare("SELECT packet_json FROM balloon_releases WHERE session_id = ? ORDER BY created_at DESC LIMIT ?")
			.all(sessionId, limit) as ReleaseRow[]
		return rows
			.map((row) => {
				try {
					return JSON.parse(row.packet_json) as ReleasePacket
				} catch {
					return null
				}
			})
			.filter((row): row is ReleasePacket => row !== null)
	}

	saveDriftPressureSnapshot(snapshot: BalloonDriftPressureSnapshot): void {
		this.ensureSession(snapshot.sessionId, snapshot.recordedAt)
		this.db
			.prepare("INSERT INTO balloon_pressure_snapshots (snapshot_id, session_id, source, pressure_json, recorded_at) VALUES (?, ?, ?, ?, ?)")
			.run(snapshot.snapshotId, snapshot.sessionId, snapshot.source, JSON.stringify(snapshot), snapshot.recordedAt)
		this.touchSession(snapshot.sessionId, snapshot.recordedAt)
	}

	listDriftPressureSnapshots(sessionId: string, limit = 50): BalloonDriftPressureSnapshot[] {
		const rows = this.db
			.prepare("SELECT pressure_json FROM balloon_pressure_snapshots WHERE session_id = ? ORDER BY recorded_at DESC LIMIT ?")
			.all(sessionId, limit) as PressureSnapshotRow[]
		return rows
			.map((row) => {
				try {
					return JSON.parse(row.pressure_json) as BalloonDriftPressureSnapshot
				} catch {
					return null
				}
			})
			.filter((row): row is BalloonDriftPressureSnapshot => row !== null)
	}

	getSessionSummary(sessionId: string): BalloonSessionSummary | null {
		const session = this.db.prepare("SELECT session_id, created_at, updated_at FROM balloon_sessions WHERE session_id = ?").get(sessionId) as
			| SessionRow
			| undefined
		if (!session) return null
		const turnCount = (this.db.prepare("SELECT COUNT(*) AS count FROM balloon_turns WHERE session_id = ?").get(sessionId) as CountRow | undefined)?.count ?? 0
		const gapCount = (this.db.prepare("SELECT COUNT(*) AS count FROM balloon_gaps WHERE session_id = ?").get(sessionId) as CountRow | undefined)?.count ?? 0
		const trickleCount =
			(this.db.prepare("SELECT COUNT(*) AS count FROM balloon_trickles WHERE session_id = ?").get(sessionId) as CountRow | undefined)?.count ?? 0
		const memoryCount =
			(this.db.prepare("SELECT COUNT(*) AS count FROM balloon_memory_ledger WHERE session_id = ?").get(sessionId) as CountRow | undefined)?.count ?? 0
		const releaseCount =
			(this.db.prepare("SELECT COUNT(*) AS count FROM balloon_releases WHERE session_id = ?").get(sessionId) as CountRow | undefined)?.count ?? 0
		return {
			sessionId,
			turnCount: Number(turnCount),
			gapCount: Number(gapCount),
			trickleCount: Number(trickleCount),
			memoryCount: Number(memoryCount),
			releaseCount: Number(releaseCount),
			lastUpdatedAt: session.updated_at,
		}
	}

	listSessionSummaries(): BalloonSessionSummary[] {
		return this.listSessionIds()
			.map((sessionId) => this.getSessionSummary(sessionId))
			.filter((summary): summary is BalloonSessionSummary => summary !== null)
	}

	saveHostValidationEvidence(evidence: BalloonHostValidationEvidence): void {
		this.db
			.prepare("INSERT INTO balloon_host_validation_runs (run_id, host, case_id, evidence_json, recorded_at) VALUES (?, ?, ?, ?, ?)")
			.run(evidence.runId, evidence.host, evidence.caseId, JSON.stringify(evidence), evidence.recordedAt)
		if (evidence.sessionId) this.touchSession(evidence.sessionId, evidence.recordedAt)
	}

	listHostValidationEvidence(host?: BalloonHostKind, limit = 100): BalloonHostValidationEvidence[] {
		const rows = host
			? (this.db
					.prepare("SELECT evidence_json FROM balloon_host_validation_runs WHERE host = ? ORDER BY recorded_at DESC LIMIT ?")
					.all(host, limit) as HostValidationRow[])
			: (this.db.prepare("SELECT evidence_json FROM balloon_host_validation_runs ORDER BY recorded_at DESC LIMIT ?").all(limit) as HostValidationRow[])
		return rows
			.map((row) => {
				try {
					return JSON.parse(row.evidence_json) as BalloonHostValidationEvidence
				} catch {
					return null
				}
			})
			.filter((row): row is BalloonHostValidationEvidence => row !== null)
	}
}

export function createDefaultBalloonDbPath(cwd: string, explicitDataDir?: string): string {
	const dataDir = explicitDataDir ? path.resolve(cwd, explicitDataDir) : path.join(cwd, ".balloon-mcp")
	return path.join(dataDir, "balloon-mcp.sqlite")
}
