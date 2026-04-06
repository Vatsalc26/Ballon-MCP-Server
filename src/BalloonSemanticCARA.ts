import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import type { SemanticCaraConfig, SemanticCaraMode, SemanticCaraPacket, SemanticCaraResult } from "./types"

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asPositiveInt(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value)
	if (typeof value === "string" && /^\d+$/u.test(value)) return Math.max(1, Number.parseInt(value, 10))
	return fallback
}

function parseMode(value: unknown): SemanticCaraMode | null {
	if (typeof value !== "string") return null
	switch (value.trim().toLowerCase()) {
		case "off":
		case "shadow":
		case "assist":
			return value.trim().toLowerCase() as SemanticCaraMode
		default:
			return null
	}
}

function uniq(values: string[], limit = 6): string[] {
	const seen = new Set<string>()
	const out: string[] = []
	for (const value of values) {
		const normalized = value.trim().replace(/\s+/g, " ")
		if (!normalized) continue
		const key = normalized.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		out.push(normalized)
		if (out.length >= limit) break
	}
	return out
}

function cleanReply(value: string): string {
	return value
		.replace(/^assistant\s*:\s*/iu, "")
		.replace(/^repaired next assistant reply\s*:\s*/iu, "")
		.replace(/```[a-z0-9_-]*\n?/giu, "")
		.replace(/```/g, "")
		.trim()
}

type SemanticCaraOverrides = {
	mode?: unknown
	adapterPath?: unknown
	timeoutMs?: unknown
	maxNotes?: unknown
}

function resolveMode(
	explicitMode: SemanticCaraMode | null,
	adapterPath: string | null,
	hasOtherOverrides: boolean,
): SemanticCaraMode {
	if (explicitMode) return explicitMode
	if (adapterPath) return "assist"
	if (hasOtherOverrides) return "shadow"
	return "off"
}

export function resolveSemanticCaraConfig(overrides?: SemanticCaraOverrides): SemanticCaraConfig {
	const modeOverride = parseMode(overrides?.mode)
	const adapterOverride = asString(overrides?.adapterPath)
	const timeoutOverride = overrides?.timeoutMs
	const maxNotesOverride = overrides?.maxNotes

	if (modeOverride || adapterOverride || timeoutOverride || maxNotesOverride) {
		const hasOtherOverrides = Boolean(timeoutOverride || maxNotesOverride)
		return {
			mode: resolveMode(modeOverride, adapterOverride, hasOtherOverrides),
			adapterPath: adapterOverride,
			timeoutMs: asPositiveInt(timeoutOverride, 8_000),
			maxNotes: asPositiveInt(maxNotesOverride, 4),
			source: "tool",
		}
	}

	const envMode = parseMode(process.env.BALLOON_SEMANTIC_CARA_MODE)
	const envAdapter = asString(process.env.BALLOON_SEMANTIC_CARA_ADAPTER)
	const envTimeout = process.env.BALLOON_SEMANTIC_CARA_TIMEOUT_MS
	const envMaxNotes = process.env.BALLOON_SEMANTIC_CARA_MAX_NOTES
	if (envMode || envAdapter || envTimeout || envMaxNotes) {
		const hasOtherEnvOverrides = Boolean(envTimeout || envMaxNotes)
		return {
			mode: resolveMode(envMode, envAdapter, hasOtherEnvOverrides),
			adapterPath: envAdapter,
			timeoutMs: asPositiveInt(envTimeout, 8_000),
			maxNotes: asPositiveInt(envMaxNotes, 4),
			source: "env",
		}
	}

	return {
		mode: "off",
		adapterPath: null,
		timeoutMs: 8_000,
		maxNotes: 4,
		source: "default",
	}
}

function buildShadowNotes(packet: SemanticCaraPacket, maxNotes: number): string[] {
	const notes: string[] = []
	if (packet.gaps.some((gap) => gap.type === "architecture_drift" || gap.type === "profile_contradiction")) {
		notes.push("Preserve the stored architecture direction and protected areas before proposing any larger change.")
	}
	if (packet.profile.protectedInterfaces.length > 0) {
		notes.push(`Keep the protected interface or contract stable: ${packet.profile.protectedInterfaces.slice(0, 2).join(" | ")}.`)
	}
	if (packet.gaps.some((gap) => gap.type === "constraint_omission")) {
		notes.push("Carry forward the stored verification obligations explicitly in the next reply.")
	}
	if (packet.profile.styleRequirements.length > 0) {
		notes.push(`Keep style and typing requirements visible: ${packet.profile.styleRequirements.slice(0, 2).join(" | ")}.`)
	}
	if (packet.hiddenRequirements.length > 0) {
		notes.push(`Surface the missing follow-on work explicitly: ${packet.hiddenRequirements.map((item) => item.requirement).slice(0, 3).join(", ")}.`)
	}
	if (packet.gaps.some((gap) => gap.type === "sycophantic_drift")) {
		notes.push("Use calm corrective language instead of agreement-heavy phrasing.")
	}
	if (packet.nextTurnStance.length > 0) {
		notes.push(`Keep the next reply anchored to: ${packet.nextTurnStance.join(" | ")}.`)
	}
	return uniq(notes, maxNotes)
}

function buildSuggestedAdditions(packet: SemanticCaraPacket, maxNotes: number): string[] {
	return uniq(
		[
			...packet.hiddenRequirements.map((item) => item.requirement),
			...packet.profile.verificationObligations,
			...packet.profile.protectedAreas,
		],
		maxNotes,
	)
}

function shadowResult(packet: SemanticCaraPacket, config: SemanticCaraConfig, status: SemanticCaraResult["status"], error: string | null = null): SemanticCaraResult {
	return {
		mode: config.mode,
		status,
		notes: buildShadowNotes(packet, config.maxNotes),
		suggestedAdditions: buildSuggestedAdditions(packet, config.maxNotes),
		rewrittenReply: null,
		correctionSummaryAddendum: null,
		error,
		providerMeta: {
			adapterPath: config.adapterPath,
			requestedAdapterPath: config.adapterPath,
			durationMs: 0,
			source: "shadow",
		},
	}
}

function parseAdapterPayload(stdout: string): Partial<Pick<SemanticCaraResult, "notes" | "suggestedAdditions" | "rewrittenReply" | "correctionSummaryAddendum">> {
	const parsed = JSON.parse(stdout) as Record<string, unknown>
	const notes = Array.isArray(parsed.notes) ? parsed.notes.filter((value): value is string => typeof value === "string") : []
	const suggestedAdditions = Array.isArray(parsed.suggestedAdditions)
		? parsed.suggestedAdditions.filter((value): value is string => typeof value === "string")
		: []
	return {
		notes: uniq(notes, 8),
		suggestedAdditions: uniq(suggestedAdditions, 8),
		rewrittenReply: asString(parsed.rewrittenReply),
		correctionSummaryAddendum: asString(parsed.correctionSummaryAddendum),
	}
}

function resolveAdapterPath(adapterPath: string): { resolvedPath: string | null; attemptedPaths: string[] } {
	if (path.isAbsolute(adapterPath)) {
		return {
			resolvedPath: fs.existsSync(adapterPath) ? adapterPath : null,
			attemptedPaths: [adapterPath],
		}
	}

	const attemptedPaths = uniq(
		[
			path.resolve(process.cwd(), adapterPath),
			path.resolve(process.cwd(), "public_pack", adapterPath),
			path.resolve(process.cwd(), "Ballon_architecture", "balloon_mcp_server", adapterPath),
			path.resolve(process.cwd(), "Ballon_architecture", "balloon_mcp_server", "public_pack", adapterPath),
		],
		8,
	)
	const resolvedPath = attemptedPaths.find((candidate) => fs.existsSync(candidate)) ?? null
	return { resolvedPath, attemptedPaths }
}

function resolveAdapterCommand(resolvedPath: string): { command: string; args: string[] } {
	const normalized = path.resolve(resolvedPath)
	if (/\.(?:mjs|cjs|js)$/iu.test(normalized)) {
		return { command: process.execPath, args: [normalized] }
	}
	return { command: normalized, args: [] }
}

export function runSemanticCara(packet: SemanticCaraPacket, config: SemanticCaraConfig): SemanticCaraResult {
	if (config.mode === "off") {
		return {
			mode: "off",
			status: "disabled",
			notes: [],
			suggestedAdditions: [],
			rewrittenReply: null,
			correctionSummaryAddendum: null,
			error: null,
			providerMeta: {
				adapterPath: null,
				durationMs: 0,
				source: "shadow",
			},
		}
	}

	if (config.mode === "shadow" || !config.adapterPath) {
		return shadowResult(packet, config, "shadow", config.mode === "assist" && !config.adapterPath ? "Semantic assist requested without an adapter path; using shadow mode." : null)
	}

	const startedAt = Date.now()
	try {
		const adapterResolution = resolveAdapterPath(config.adapterPath)
		if (!adapterResolution.resolvedPath) {
			return {
				...shadowResult(
					packet,
					config,
					"error",
					`Semantic adapter not found. Tried: ${adapterResolution.attemptedPaths.join(" | ")}`,
				),
				providerMeta: {
					adapterPath: null,
					requestedAdapterPath: config.adapterPath,
					durationMs: Date.now() - startedAt,
					source: "adapter",
				},
			}
		}
		const command = resolveAdapterCommand(adapterResolution.resolvedPath)
		const completed = spawnSync(command.command, command.args, {
			input: JSON.stringify(packet),
			encoding: "utf8",
			timeout: config.timeoutMs,
			maxBuffer: 1024 * 1024,
			windowsHide: true,
		})
		const durationMs = Date.now() - startedAt
		if (completed.error) {
			return {
				...shadowResult(packet, config, "error", completed.error.message),
				providerMeta: { adapterPath: adapterResolution.resolvedPath, requestedAdapterPath: config.adapterPath, durationMs, source: "adapter" },
			}
		}
		if ((completed.status ?? 0) !== 0) {
			const stderrText = asString(completed.stderr) ?? `Semantic adapter exited with status ${completed.status ?? "unknown"}.`
			return {
				...shadowResult(packet, config, "error", stderrText),
				providerMeta: { adapterPath: adapterResolution.resolvedPath, requestedAdapterPath: config.adapterPath, durationMs, source: "adapter" },
			}
		}
		const stdoutText = asString(completed.stdout)
		if (!stdoutText) {
			return {
				...shadowResult(packet, config, "error", "Semantic adapter returned no JSON payload."),
				providerMeta: { adapterPath: adapterResolution.resolvedPath, requestedAdapterPath: config.adapterPath, durationMs, source: "adapter" },
			}
		}
		const adapterPayload = parseAdapterPayload(stdoutText)
		return {
			mode: "assist",
			status: "assisted",
			notes: uniq([...(adapterPayload.notes ?? []), ...buildShadowNotes(packet, config.maxNotes)], config.maxNotes),
			suggestedAdditions: uniq([...(adapterPayload.suggestedAdditions ?? []), ...buildSuggestedAdditions(packet, config.maxNotes)], config.maxNotes),
			rewrittenReply: adapterPayload.rewrittenReply ? cleanReply(adapterPayload.rewrittenReply) : null,
			correctionSummaryAddendum: adapterPayload.correctionSummaryAddendum ? cleanReply(adapterPayload.correctionSummaryAddendum) : null,
			error: null,
			providerMeta: {
				adapterPath: adapterResolution.resolvedPath,
				requestedAdapterPath: config.adapterPath,
				durationMs,
				source: "adapter",
			},
		}
	} catch (error) {
		return {
			...shadowResult(packet, config, "error", error instanceof Error ? error.message : String(error)),
			providerMeta: { adapterPath: config.adapterPath, requestedAdapterPath: config.adapterPath, durationMs: Date.now() - startedAt, source: "adapter" },
		}
	}
}

export function mergeSemanticRepair(
	packet: SemanticCaraPacket,
	semantic: SemanticCaraResult,
): {
	repairedReply: string
	correctionSummary: string
} {
	const repairedReply = semantic.rewrittenReply ?? packet.deterministicReply
	if (!semantic.correctionSummaryAddendum) {
		return {
			repairedReply,
			correctionSummary: packet.correctionSummary,
		}
	}
	return {
		repairedReply,
		correctionSummary: `${packet.correctionSummary} ${semantic.correctionSummaryAddendum}`.trim(),
	}
}
