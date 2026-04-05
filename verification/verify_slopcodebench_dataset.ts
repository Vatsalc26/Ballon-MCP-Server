import fs from "node:fs"
import path from "node:path"

import { getSlopCodeDatasetStatus, resolveSlopCodeBenchDatasetRoot } from "../src/SlopCodeBench"

type DatasetVerification = {
	datasetRoot: string
	repoRoot: string
	topLevelDirs: string[]
	problemNames: string[]
	runConfigs: string[]
	promptConfigs: string[]
	environmentConfigs: string[]
	hasGitMetadata: boolean
	criticalMissing: string[]
	warnings: string[]
}

const REQUIRED_TOP_LEVEL_DIRS = [".claude", ".codex", "assets", "configs", "docs", "examples", "problems", "scripts", "src", "tests"] as const
const REQUIRED_TOP_LEVEL_FILES = [".gitignore", "AGENTS.md", "CITATION.cff", "CLAUDE.md", "CONTRIBUTING.md", "LICENSE", "README.md", "pyproject.toml", "uv.lock"] as const
const REQUIRED_NESTED_MARKERS = [
	"configs/environments/docker-python3.12-uv.yaml",
	"configs/prompts/just-solve.jinja",
	"configs/rubrics/llm_judge.jsonl",
	"configs/runs/single_shot.yaml",
	"docs/execution/README.md",
	"docs/problems/README.md",
	"problems/trajectory_api/tests/test_checkpoint_1.py",
	"src/slop_code/__init__.py",
	"tests/metrics/checkpoint_results_test.py",
] as const
const README_MARKERS = [
	"SlopCodeBench (SCBench)",
	"https://github.com/SprocketLab/slop-code-bench",
	"uv run slop-code run",
	"configs/environments/docker-python3.12-uv.yaml",
] as const
const PYPROJECT_MARKERS = ['name = "slop-code-bench"', '"slop-code" = "slop_code.entrypoints.cli:app"'] as const
const CITATION_MARKERS = ["repository-code: \"https://github.com/SprocketLab/slop-code-bench\"", "doi: 10.5281/zenodo.19257129"] as const

function parseDatasetRoot(): string {
	const args = process.argv.slice(2)
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--dataset-root") {
			const value = args[index + 1]
			if (value) return path.resolve(process.cwd(), value)
		}
	}
	return resolveSlopCodeBenchDatasetRoot(undefined, process.cwd()) ?? path.resolve(process.cwd(), "slop-code-bench-main")
}

function readFileSafe(filePath: string): string {
	try {
		return fs.readFileSync(filePath, "utf8")
	} catch {
		return ""
	}
}

function listNames(dirPath: string, onlyDirectories = false): string[] {
	if (!fs.existsSync(dirPath)) return []
	return fs
		.readdirSync(dirPath, { withFileTypes: true })
		.filter((entry) => (onlyDirectories ? entry.isDirectory() : true))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right))
}

function verifyDataset(datasetRoot: string, repoRoot: string): DatasetVerification {
	const criticalMissing: string[] = []
	const warnings: string[] = []
	const datasetStatus = getSlopCodeDatasetStatus(datasetRoot, process.cwd())

	if (!fs.existsSync(datasetRoot)) {
		criticalMissing.push(`dataset root missing: ${datasetRoot}`)
		return {
			datasetRoot,
			repoRoot,
			topLevelDirs: [],
			problemNames: [],
			runConfigs: [],
			promptConfigs: [],
			environmentConfigs: [],
			hasGitMetadata: false,
			criticalMissing,
			warnings,
		}
	}

	for (const dirName of REQUIRED_TOP_LEVEL_DIRS) {
		if (!fs.existsSync(path.join(datasetRoot, dirName))) criticalMissing.push(`missing top-level directory: ${dirName}`)
	}
	for (const fileName of REQUIRED_TOP_LEVEL_FILES) {
		if (!fs.existsSync(path.join(datasetRoot, fileName))) criticalMissing.push(`missing top-level file: ${fileName}`)
	}
	for (const marker of REQUIRED_NESTED_MARKERS) {
		if (!fs.existsSync(path.join(datasetRoot, marker))) criticalMissing.push(`missing nested marker: ${marker}`)
	}

	const readmeText = readFileSafe(path.join(datasetRoot, "README.md"))
	for (const marker of README_MARKERS) {
		if (!readmeText.includes(marker)) criticalMissing.push(`README marker not found: ${marker}`)
	}

	const pyprojectText = readFileSafe(path.join(datasetRoot, "pyproject.toml"))
	for (const marker of PYPROJECT_MARKERS) {
		if (!pyprojectText.includes(marker)) criticalMissing.push(`pyproject marker not found: ${marker}`)
	}

	const citationText = readFileSafe(path.join(datasetRoot, "CITATION.cff"))
	for (const marker of CITATION_MARKERS) {
		if (!citationText.includes(marker)) criticalMissing.push(`citation marker not found: ${marker}`)
	}

	const hasGitMetadata = datasetStatus.hasGitMetadata
	warnings.push(...datasetStatus.warnings)

	const problemNames = listNames(path.join(datasetRoot, "problems"), true)
	if (problemNames.length < 10) warnings.push(`problem count looks unusually low: ${problemNames.length}`)

	const runConfigs = listNames(path.join(datasetRoot, "configs", "runs"))
	const promptConfigs = listNames(path.join(datasetRoot, "configs", "prompts"))
	const environmentConfigs = listNames(path.join(datasetRoot, "configs", "environments"))

	return {
		datasetRoot,
		repoRoot,
		topLevelDirs: listNames(datasetRoot, true),
		problemNames,
		runConfigs,
		promptConfigs,
		environmentConfigs,
		hasGitMetadata,
		criticalMissing,
		warnings,
	}
}

function formatVerification(result: DatasetVerification): string {
	const lines = [
		"SlopCodeBench dataset verification",
		`Dataset root: ${result.datasetRoot}`,
		`Balloon repo root: ${result.repoRoot}`,
		`Git metadata present: ${result.hasGitMetadata ? "yes" : "no"}`,
		`Problem count: ${result.problemNames.length}`,
		`Problems: ${result.problemNames.join(", ") || "none found"}`,
		`Run configs: ${result.runConfigs.join(", ") || "none found"}`,
		`Prompt configs: ${result.promptConfigs.join(", ") || "none found"}`,
		`Environment configs: ${result.environmentConfigs.join(", ") || "none found"}`,
	]
	if (result.criticalMissing.length > 0) {
		lines.push("", "Critical missing markers")
		lines.push(...result.criticalMissing.map((item, index) => `${index + 1}. ${item}`))
	} else {
		lines.push("", "Critical markers: all expected markers present")
	}
	if (result.warnings.length > 0) {
		lines.push("", "Warnings")
		lines.push(...result.warnings.map((item, index) => `${index + 1}. ${item}`))
	}
	return lines.join("\n")
}

function main(): void {
	const repoRoot = process.cwd()
	const datasetRoot = parseDatasetRoot()
	const result = verifyDataset(datasetRoot, repoRoot)
	console.log(formatVerification(result))
	if (result.criticalMissing.length > 0) {
		process.exitCode = 1
		return
	}
}

main()
