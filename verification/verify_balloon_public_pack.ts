import fs from "node:fs"
import path from "node:path"

type BalloonServerManifest = {
	name?: string
	title?: string
	repository?: {
		url?: string
		source?: string
	}
	packages?: Array<{
		registryType?: string
		identifier?: string
		version?: string
		transport?: {
			type?: string
		}
	}>
}

export type BalloonPublicPackHarnessResult = {
	packageScriptPresent: boolean
	requiredFilesPresent: boolean
	serverManifestPresent: boolean
	hostGuidanceAligned: boolean
	placeholderExamplesSafe: boolean
	noForbiddenMarkers: boolean
	noAbsoluteLocalPaths: boolean
	details: string[]
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

function readText(filePath: string): string {
	return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : ""
}

function readJson<T>(filePath: string): T | null {
	try {
		return JSON.parse(readText(filePath)) as T
	} catch {
		return null
	}
}

function includesAll(text: string, snippets: string[]): boolean {
	return snippets.every((snippet) => text.includes(snippet))
}

function resolveBalloonPublicPackDir(rootDir: string): string {
	const monorepoDir = path.join(rootDir, "Ballon_architecture", "balloon_mcp_server", "public_pack")
	if (fs.existsSync(monorepoDir)) return monorepoDir
	throw new Error(`Could not resolve Balloon public_pack from ${rootDir}`)
}

function walkFiles(dirPath: string): string[] {
	const results: string[] = []
	for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
		const absolutePath = path.join(dirPath, entry.name)
		if (entry.isDirectory()) {
			results.push(...walkFiles(absolutePath))
			continue
		}
		results.push(absolutePath)
	}
	return results
}

function isTextLikeFile(filePath: string): boolean {
	const normalized = filePath.replace(/\\/g, "/").toLowerCase()
	return (
		normalized.endsWith(".md") ||
		normalized.endsWith(".json") ||
		normalized.endsWith(".yml") ||
		normalized.endsWith(".yaml") ||
		normalized.endsWith(".txt") ||
		normalized.endsWith(".cff") ||
		normalized.endsWith(".mjs") ||
		normalized.endsWith(".gitignore") ||
		normalized.endsWith("/license")
	)
}

function relativeFrom(baseDir: string, filePath: string): string {
	return path.relative(baseDir, filePath).replace(/\\/g, "/")
}

function findForbiddenMarkers(publicPackDir: string, files: string[]): string[] {
	const markers = [
		"Swarmcoder2",
		"Coding_sessions/",
		"PROJECT_TRUTH_LENS.md",
		".swarm/",
		".swarm-worktrees/",
		"private source-of-truth",
		"private home repo",
		"Vatsalc26/Swarmcoder2",
		"Portfolio_Website_Prep_Session",
	]
	const hits: string[] = []
	for (const filePath of files) {
		if (!isTextLikeFile(filePath)) continue
		const text = readText(filePath)
		for (const marker of markers) {
			if (text.includes(marker)) hits.push(`${relativeFrom(publicPackDir, filePath)} -> ${marker}`)
		}
	}
	return hits
}

function findAbsoluteLocalPaths(publicPackDir: string, files: string[]): string[] {
	const hits: string[] = []
	const patterns: RegExp[] = [
		/\b[A-Za-z]:[\\/][^\s"'`]+/gu,
		/\/Users\/[^\s"'`]+/gu,
		/\/home\/[^\s"'`]+/gu,
	]
	for (const filePath of files) {
		if (!isTextLikeFile(filePath)) continue
		const text = readText(filePath)
		for (const pattern of patterns) {
			const matches = text.match(pattern) ?? []
			for (const match of matches) hits.push(`${relativeFrom(publicPackDir, filePath)} -> ${match}`)
		}
	}
	return hits
}

export async function runBalloonPublicPackHarness(rootDir = resolveRootDir()): Promise<BalloonPublicPackHarnessResult> {
	const details: string[] = []
	const packageJson = readJson<{ scripts?: Record<string, string> }>(path.join(rootDir, "package.json")) ?? {}
	const publicPackDir = resolveBalloonPublicPackDir(rootDir)
	const publicPackFiles = walkFiles(publicPackDir)

	const packageScriptPresent =
		packageJson.scripts?.["verify:balloon:public-pack"] === "npm run build && node dist/Ballon_architecture/balloon_mcp_server/verification/verify_balloon_public_pack.js"

	const requiredRelativeFiles = [
		"README.md",
		"LICENSE",
		"SECURITY.md",
		"SUPPORT.md",
		"server.json",
		"docs/INSTALL.md",
		"docs/HOST_COMPATIBILITY.md",
		"docs/HOST_VALIDATION.md",
		"docs/CLINE_QUICKSTART.md",
		"docs/ROO_CODE_QUICKSTART.md",
		"docs/READINESS.md",
		"examples/vscode_mcp.example.json",
		"examples/cline_mcp_settings.example.json",
		"examples/roo_mcp.example.json",
		"examples/claude_desktop_config.example.json",
		"examples/host_setup_packet_request.example.json",
		"examples/host_setup_validation_request.example.json",
		"examples/install_diagnostics_request.example.json",
		"examples/host_flow_packet_request.example.json",
		"examples/host_validation_suite_request.example.json",
		"examples/host_validation_result_request.example.json",
		"examples/host_validation_summary_request.example.json",
		"examples/slopcode_run_evidence_request.example.json",
		"examples/slopcode_run_evidence_summary_request.example.json",
	]
	const missingFiles = requiredRelativeFiles.filter((relativePath) => !fs.existsSync(path.join(publicPackDir, relativePath)))
	const requiredFilesPresent = missingFiles.length === 0

	const serverManifest = readJson<BalloonServerManifest>(path.join(publicPackDir, "server.json"))
	const serverManifestPresent =
		serverManifest?.name === "io.github.vatsalc26/balloon-mcp" &&
		serverManifest.title === "Balloon MCP" &&
		serverManifest.repository?.url === "https://github.com/Vatsalc26/Ballon-MCP-Server" &&
		serverManifest.repository?.source === "github" &&
		(serverManifest.packages?.some(
			(pkg) => pkg.registryType === "npm" && pkg.identifier === "balloon-mcp-server" && pkg.transport?.type === "stdio",
		) ??
			false)

	const readmeText = readText(path.join(publicPackDir, "README.md"))
	const installText = readText(path.join(publicPackDir, "docs", "INSTALL.md"))
	const hostCompatibilityText = readText(path.join(publicPackDir, "docs", "HOST_COMPATIBILITY.md"))
	const hostValidationText = readText(path.join(publicPackDir, "docs", "HOST_VALIDATION.md"))
	const hostGuidanceAligned =
		includesAll(readmeText, [
			"`balloon_prepare_host_setup_packet`",
			"`balloon_validate_host_setup`",
			"`balloon_run_install_diagnostics`",
			"`balloon_prepare_host_flow_packet`",
			"`balloon_prepare_host_validation_suite`",
			"`balloon_record_host_validation_result`",
			"`balloon_summarize_host_validation_results`",
			"`balloon://hosts/matrix`",
		]) &&
		includesAll(installText, [
			"`balloon_prepare_host_setup_packet`",
			"`balloon_validate_host_setup`",
			"`balloon_run_install_diagnostics`",
			"`balloon_prepare_host_flow_packet`",
			"`balloon_prepare_host_validation_suite`",
			"`balloon_record_host_validation_result`",
			"`balloon_summarize_host_validation_results`",
			"`balloon://hosts/matrix`",
		]) &&
		includesAll(hostCompatibilityText, [
			"`balloon_prepare_host_setup_packet`",
			"`balloon_validate_host_setup`",
			"`balloon_run_install_diagnostics`",
			"`balloon_prepare_host_flow_packet`",
			"`balloon_prepare_host_validation_suite`",
			"`balloon_record_host_validation_result`",
			"`balloon_summarize_host_validation_results`",
			"`balloon://hosts/{host}`",
			"`balloon://hosts/{host}/playbook`",
			"`balloon://hosts/{host}/validation-suite`",
			"`balloon://hosts/{host}/validation-evidence`",
		]) &&
		includesAll(hostValidationText, [
			"`balloon_run_install_diagnostics`",
			"`balloon_prepare_host_flow_packet`",
			"`balloon_prepare_host_validation_suite`",
			"`balloon_record_host_validation_result`",
			"`balloon_summarize_host_validation_results`",
			"`balloon://hosts/{host}/playbook`",
			"`balloon://hosts/{host}/validation-suite`",
			"`balloon://hosts/{host}/validation-evidence`",
		])

	const placeholderChecks = [
		{
			relativePath: "examples/cline_mcp_settings.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH"],
		},
		{
			relativePath: "examples/roo_mcp.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH"],
		},
		{
			relativePath: "examples/claude_desktop_config.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH"],
		},
		{
			relativePath: "examples/host_setup_packet_request.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH"],
		},
		{
			relativePath: "examples/host_setup_validation_request.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH", "REPLACE_WITH_YOUR_HOST_CONFIG_PATH"],
		},
		{
			relativePath: "examples/install_diagnostics_request.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_BALLOON_MCP_REPO_PATH", "REPLACE_WITH_YOUR_HOST_CONFIG_PATH"],
		},
		{
			relativePath: "examples/host_flow_packet_request.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_SESSION_ID", "REPLACE_WITH_YOUR_USER_REQUEST"],
		},
		{
			relativePath: "examples/host_validation_suite_request.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_SESSION_ID", "REPLACE_WITH_YOUR_USER_REQUEST"],
		},
		{
			relativePath: "examples/host_validation_result_request.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_VALIDATION_SUMMARY", "REPLACE_WITH_YOUR_SESSION_ID"],
		},
		{
			relativePath: "examples/host_validation_summary_request.example.json",
			requiredSnippets: ["\"host\": \"vscode\""],
		},
		{
			relativePath: "examples/slopcode_run_evidence_request.example.json",
			requiredSnippets: ["REPLACE_WITH_YOUR_SESSION_ID", "REPLACE_WITH_YOUR_SLOPCODEBENCH_ROOT"],
		},
		{
			relativePath: "examples/vscode_mcp.example.json",
			requiredSnippets: ["${workspaceFolder}"],
		},
	]
	const placeholderFailures: string[] = []
	for (const check of placeholderChecks) {
		const text = readText(path.join(publicPackDir, check.relativePath))
		if (!includesAll(text, check.requiredSnippets)) placeholderFailures.push(check.relativePath)
	}
	const placeholderExamplesSafe = placeholderFailures.length === 0

	const forbiddenMarkerHits = findForbiddenMarkers(publicPackDir, publicPackFiles)
	const absolutePathHits = findAbsoluteLocalPaths(publicPackDir, publicPackFiles)
	const noForbiddenMarkers = forbiddenMarkerHits.length === 0
	const noAbsoluteLocalPaths = absolutePathHits.length === 0

	details.push(
		`publicPackFileCount=${publicPackFiles.length}`,
		`missingFiles=${missingFiles.length}`,
		`placeholderFailures=${placeholderFailures.length}`,
		`forbiddenMarkerHits=${forbiddenMarkerHits.length}`,
		`absolutePathHits=${absolutePathHits.length}`,
	)
	if (missingFiles.length > 0) details.push(...missingFiles.map((file) => `missing:${file}`))
	if (placeholderFailures.length > 0) details.push(...placeholderFailures.map((file) => `placeholder:${file}`))
	if (forbiddenMarkerHits.length > 0) details.push(...forbiddenMarkerHits.map((hit) => `forbidden:${hit}`))
	if (absolutePathHits.length > 0) details.push(...absolutePathHits.map((hit) => `absolute:${hit}`))

	return {
		packageScriptPresent,
		requiredFilesPresent,
		serverManifestPresent,
		hostGuidanceAligned,
		placeholderExamplesSafe,
		noForbiddenMarkers,
		noAbsoluteLocalPaths,
		details,
	}
}

export function formatBalloonPublicPackHarnessResult(result: BalloonPublicPackHarnessResult): string {
	return [
		`Package script present: ${result.packageScriptPresent ? "PASS" : "FAIL"}`,
		`Required public-pack files present: ${result.requiredFilesPresent ? "PASS" : "FAIL"}`,
		`Server manifest present: ${result.serverManifestPresent ? "PASS" : "FAIL"}`,
		`Host guidance aligned: ${result.hostGuidanceAligned ? "PASS" : "FAIL"}`,
		`Placeholder examples safe: ${result.placeholderExamplesSafe ? "PASS" : "FAIL"}`,
		`No forbidden private markers: ${result.noForbiddenMarkers ? "PASS" : "FAIL"}`,
		`No absolute local paths: ${result.noAbsoluteLocalPaths ? "PASS" : "FAIL"}`,
		...(result.details.length > 0 ? ["Details:", ...result.details.map((detail) => `- ${detail}`)] : []),
	].join("\n")
}

async function main(): Promise<void> {
	const result = await runBalloonPublicPackHarness()
	console.log(formatBalloonPublicPackHarnessResult(result))
	process.exit(
		result.packageScriptPresent &&
			result.requiredFilesPresent &&
			result.serverManifestPresent &&
			result.hostGuidanceAligned &&
			result.placeholderExamplesSafe &&
			result.noForbiddenMarkers &&
			result.noAbsoluteLocalPaths
			? 0
			: 1,
	)
}

if (require.main === module) {
	void main().catch((err) => {
		console.error(`[verify:balloon:public-pack] ${err instanceof Error ? err.message : String(err)}`)
		process.exit(1)
	})
}
