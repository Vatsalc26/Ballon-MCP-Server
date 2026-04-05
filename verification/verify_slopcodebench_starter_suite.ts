import { buildSlopCodeProblemPreparation, buildSlopCodeStarterSuite, resolveSlopCodeBenchDatasetRoot } from "../src/SlopCodeBench"

function parseDatasetRoot(): string | undefined {
	const args = process.argv.slice(2)
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--dataset-root") return args[index + 1]
	}
	return undefined
}

function main(): void {
	const datasetRoot = resolveSlopCodeBenchDatasetRoot(parseDatasetRoot(), process.cwd())
	const suite = buildSlopCodeStarterSuite(datasetRoot ?? undefined, process.cwd())
	const lines = [
		"SlopCodeBench starter-suite verification",
		`Dataset root: ${suite.datasetStatus.datasetRoot ?? "not found"}`,
		`Dataset present: ${suite.datasetStatus.present ? "yes" : "no"}`,
		`Verification status: ${suite.datasetStatus.verificationStatus}`,
		`Git metadata present: ${suite.datasetStatus.hasGitMetadata ? "yes" : "no"}`,
	]

	if (!suite.datasetStatus.present) {
		lines.push("", "Warnings", ...suite.datasetStatus.warnings.map((warning, index) => `${index + 1}. ${warning}`))
		console.log(lines.join("\n"))
		process.exitCode = 1
		return
	}

	let hasErrors = false
	for (const entry of suite.entries) {
		const preparation = buildSlopCodeProblemPreparation(entry.problemName, datasetRoot ?? undefined, process.cwd())
		if (!preparation) {
			hasErrors = true
			lines.push("", `${entry.problemName}: missing starter-suite preparation packet`)
			continue
		}
		const foundCheckpoints = preparation.checkpointFiles.filter((file) => file.exists).length
		lines.push(
			"",
			`${entry.problemName}: checkpoints ${foundCheckpoints}/${entry.checkpointCount}`,
			`Checkpoint batch: ${entry.recommendedCheckpointBatch.join(", ")}`,
			`Force staged count: ${entry.recommendedForceStageCount}`,
		)
		if (preparation.missingFiles.length > 0) {
			hasErrors = true
			lines.push(...preparation.missingFiles.map((file, index) => `  missing ${index + 1}: ${file}`))
		}
	}

	if (suite.datasetStatus.warnings.length > 0) {
		lines.push("", "Warnings", ...suite.datasetStatus.warnings.map((warning, index) => `${index + 1}. ${warning}`))
	}

	console.log(lines.join("\n"))
	if (hasErrors) process.exitCode = 1
}

main()
