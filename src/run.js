import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { summarize } from "./ai.js"
import { evaluate, shouldFail } from "./engine.js"
import { fetchPullFiles, upsertComment } from "./github.js"
import { defaultPolicyText } from "./policy.js"
import { runScenario } from "./scenarios.js"

const REVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review", "edited"])

export async function reviewEvent(options) {
  const eventName = options.eventName || ""
  const event = options.event || {}
  if (eventName !== "pull_request") {
    return { exitCode: 0, skipped: "not a pull request" }
  }
  if (event.action && !REVIEW_ACTIONS.has(event.action)) {
    return { exitCode: 0, skipped: event.action }
  }

  const pull = event.pull_request
  if (!pull) return { exitCode: 1, error: "pull_request payload has no pull_request object" }

  const policyPath = options.policyPath || ".agent-gate/policy.yaml"
  const absolute = resolve(options.workspace || process.cwd(), policyPath)
  let policyText = defaultPolicyText
  let policyMissing = true
  if (existsSync(absolute)) {
    policyText = readFileSync(absolute, "utf8")
    policyMissing = false
  } else if (options.readText) {
    const fromReader = options.readText(absolute)
    if (fromReader != null) {
      policyText = fromReader
      policyMissing = false
    }
  }

  let files
  try {
    files = await fetchPullFiles({
      repository: options.repository,
      number: pull.number,
      token: options.token,
      fetchImpl: options.fetchImpl,
    })
  } catch (error) {
    return { exitCode: 1, error: error.message }
  }

  const actor = pull.user?.login || "unknown"
  const extraFindings = options.extraFindings || (options.skipPython ? [] : pythonFindings(files))
  let report
  try {
    report = evaluate({
      actor,
      actorType: pull.user?.type || "User",
      files,
      policyText,
      policyMissing,
      failOnRisk: options.failOnRisk,
      extraFindings,
    })
  } catch (error) {
    return { exitCode: 1, error: `Policy could not be read: ${error.message}` }
  }

  if (options.apiKey) {
    const model = await summarize({
      apiKey: options.apiKey,
      model: options.model,
      baseUrl: options.baseUrl,
      comment: report.comment,
      fetchImpl: options.fetchImpl,
    })
    report = evaluate({
      actor,
      actorType: pull.user?.type || "User",
      files,
      policyText,
      policyMissing,
      failOnRisk: options.failOnRisk,
      extraFindings,
      modelSummary: model.summary,
      modelError: model.error,
    })
  }

  try {
    await upsertComment({
      repository: options.repository,
      number: pull.number,
      token: options.token,
      body: report.comment,
      fetchImpl: options.fetchImpl,
    })
  } catch (error) {
    options.log?.(`Agent Gate could not post the comment: ${error.message}`)
  }

  if (options.summary) options.summary(report.comment)
  return { exitCode: shouldFail(report) ? 1 : 0, report }
}

async function main() {
  const scenarioFlag = process.argv.indexOf("--scenario")
  if (scenarioFlag !== -1) {
    const report = runScenario(process.argv[scenarioFlag + 1])
    process.stdout.write(report.comment)
    process.exit(shouldFail(report) ? 1 : 0)
  }

  if (!process.env.GITHUB_EVENT_PATH) {
    process.stderr.write("Agent Gate runs inside GitHub Actions, or locally with --scenario <id>.\n")
    process.exit(1)
  }

  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  const result = await reviewEvent({
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
    workspace: process.env.GITHUB_WORKSPACE || process.cwd(),
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.AGENT_GATE_TOKEN || process.env.GITHUB_TOKEN,
    policyPath: process.env.AGENT_GATE_POLICY_PATH,
    failOnRisk: process.env.AGENT_GATE_FAIL_ON_RISK,
    apiKey: process.env.BLAST_RADIUS_API_KEY || "",
    model: process.env.BLAST_RADIUS_MODEL || "",
    baseUrl: process.env.BLAST_RADIUS_BASE_URL || "",
    fetchImpl: globalThis.fetch,
    log: (message) => process.stderr.write(`${message}\n`),
    summary: (comment) => {
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${comment}`)
      }
    },
  })

  if (result.error) process.stderr.write(`${result.error}\n`)
  if (result.skipped) process.stdout.write(`Agent Gate skipped: ${result.skipped}\n`)
  process.exit(result.exitCode)
}

function pythonFindings(files) {
  const script = fileURLToPath(new URL("../scanner/scan.py", import.meta.url))
  const python = process.platform === "win32" ? "python" : "python3"
  const result = spawnSync(python, [script], {
    input: JSON.stringify({ files }),
    encoding: "utf8",
    timeout: 20000,
  })
  if (result.status !== 0 || !result.stdout) return []
  try {
    const payload = JSON.parse(result.stdout)
    return Array.isArray(payload.findings) ? payload.findings : []
  } catch {
    return []
  }
}

const calledDirectly = process.argv[1] && process.argv[1].endsWith(`${"run"}.js`)
if (calledDirectly) {
  main()
}
