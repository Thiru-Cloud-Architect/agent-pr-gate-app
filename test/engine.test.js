import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { summarize } from "../src/ai.js"
import { shouldFail } from "../src/engine.js"
import { findExistingComment } from "../src/github.js"
import { matchGlob, parsePolicy } from "../src/policy.js"
import { reviewEvent } from "../src/run.js"
import { samplePolicyText } from "../src/samplePolicy.js"
import { runScenario } from "../src/scenarios.js"

test("sample policy file matches the policy the demo runs", () => {
  const onDisk = readFileSync(new URL("../examples/policy.yaml", import.meta.url), "utf8")
  assert.equal(onDisk.trim(), samplePolicyText.trim())
  const policy = parsePolicy(samplePolicyText)
  assert.equal(policy.agents.length, 2)
  assert.equal(policy.agents[0].deny[0], "infra/prod/**")
  assert.equal(policy.paths[2].path, "**/*.tf")
})

test("globs match terraform, helm, and prod paths", () => {
  assert.equal(matchGlob("infra/prod/**", "infra/prod/rds.tf"), true)
  assert.equal(matchGlob("infra/prod/**", "infra/staging/rds.tf"), false)
  assert.equal(matchGlob("**/*.tf", "rds.tf"), true)
  assert.equal(matchGlob("**/*.tf", "infra/prod/rds.tf"), true)
  assert.equal(matchGlob("charts/*/values.yaml", "charts/payments/values.yaml"), true)
  assert.equal(matchGlob("docs/**", "docs/runbook.md"), true)
  assert.equal(matchGlob("docs/**", "README.md"), false)
  assert.equal(matchGlob("**/values-*.yaml", "charts/payments/values-prod.yaml"), true)
})

test("agent on production is revoked and the comment names the blast radius", () => {
  const report = runScenario("agent-prod")
  assert.equal(report.verdict, "revoked")
  assert.equal(report.risk, "high")
  assert.match(report.comment, /db\.t4g\.micro/)
  assert.match(report.comment, /db\.m6g\.large/)
  assert.match(report.comment, /replica count changes from 2 to 8/)
  assert.match(report.comment, /terraform apply/)
  assert.match(report.comment, /No model was called/)
  assert.match(report.comment, /BLAST_RADIUS_API_KEY/)
  assert.match(report.comment, /Ask a human/)
  assert.equal(shouldFail(report), false)
  const blocking = runScenario("agent-prod")
  blocking.failOnRisk = "high"
  assert.equal(shouldFail(blocking), true)
  const example = readFileSync(new URL("../examples/comment.md", import.meta.url), "utf8")
  assert.equal(example, report.comment)
})

test("humans and allowed bots stay informational", () => {
  const human = runScenario("human-docs")
  assert.equal(human.verdict, "allowed")
  assert.equal(human.risk, "low")
  const bot = runScenario("dependabot")
  assert.equal(bot.verdict, "allowed")
  assert.equal(bot.risk, "low")
  const unknown = runScenario("unknown-bot")
  assert.equal(unknown.verdict, "needs-human")
  assert.equal(unknown.risk, "high")
  assert.match(unknown.comment, /nightly-release\[bot\]/)
  assert.match(unknown.comment, /kill switch/)
})

test("readme install snippet matches action.yml", () => {
  const action = readFileSync(new URL("../action.yml", import.meta.url), "utf8")
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  const block = readme.match(/<!-- install-snippet:start -->([\s\S]*?)<!-- install-snippet:end -->/)
  assert.ok(block, "README is missing the install snippet markers")
  const yaml = block[1].replace(/```yaml|```/g, "").trim()
  const lines = yaml.split("\n")
  assert.equal(lines.length, 6)
  assert.equal(lines[0], "- uses: Thiru-Cloud-Architect/agent-pr-gate-app@v1")
  for (const input of ["fail-on-risk", "policy-path", "api-key", "model", "token"]) {
    assert.match(action, new RegExp(`^  ${input}:`, "m"))
  }
  assert.match(action, /default: never/)
  assert.match(action, /default: \.agent-gate\/policy\.yaml/)
  assert.match(yaml, /fail-on-risk: never/)
  assert.match(yaml, /policy-path: \.agent-gate\/policy\.yaml/)
  assert.match(yaml, /secrets\.BLAST_RADIUS_API_KEY/)
  assert.match(yaml, /vars\.BLAST_RADIUS_MODEL/)
})

test("posts one comment and does not call a model when the key is absent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-gate-"))
  mkdirSync(join(dir, ".agent-gate"))
  writeFileSync(join(dir, ".agent-gate", "policy.yaml"), samplePolicyText)
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body, headers: options.headers })
    if (url.includes("/pulls/7/files")) {
      return jsonResponse([{ filename: "docs/runbook.md", status: "modified", patch: "" }])
    }
    if (url.includes("/comments?per_page=100")) return jsonResponse([])
    if (url.endsWith("/issues/7/comments")) return jsonResponse({ id: 11 })
    throw new Error(`unexpected ${options.method || "GET"} ${url}`)
  }

  const result = await reviewEvent({
    eventName: "pull_request",
    event: {
      action: "opened",
      pull_request: { number: 7, user: { login: "thirumalai", type: "User" } },
    },
    workspace: dir,
    repository: "acme/payments",
    token: "test-token",
    failOnRisk: "never",
    fetchImpl,
  })

  assert.equal(result.exitCode, 0)
  assert.equal(result.report.verdict, "allowed")
  assert.equal(calls.some((call) => call.url.includes("chat/completions")), false)
  const post = calls.find((call) => call.method === "POST")
  assert.equal(post.headers.Authorization, "Bearer test-token")
  assert.match(JSON.parse(post.body).body, /<!-- agent-gate -->/)
})

test("updates an existing comment and fails the job only for high risk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-gate-"))
  const calls = []
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" })
    if (url.includes("/pulls/9/files")) {
      return jsonResponse([
        {
          filename: "infra/prod/rds.tf",
          status: "modified",
          patch: '-  instance_class = "db.t4g.micro"\n+  instance_class = "db.m6g.large"\n',
        },
      ])
    }
    if (url.includes("/comments?per_page=100")) {
      return jsonResponse([{ id: 44, body: "<!-- agent-gate -->\nold" }])
    }
    if (url.includes("/comments/44")) return jsonResponse({ id: 44 })
    if (url.includes("chat/completions")) return jsonResponse({}, 500)
    throw new Error(`unexpected ${url}`)
  }

  const result = await reviewEvent({
    eventName: "pull_request",
    event: {
      action: "synchronize",
      pull_request: { number: 9, user: { login: "cursor[bot]", type: "Bot" } },
    },
    workspace: dir,
    repository: "acme/payments",
    token: "test-token",
    failOnRisk: "high",
    apiKey: "sk-test",
    fetchImpl,
  })

  assert.equal(result.exitCode, 1)
  assert.equal(result.report.risk, "high")
  assert.match(result.report.comment, /Model call failed/)
  assert.equal(calls.some((call) => call.method === "PATCH"), true)
  assert.equal(
    calls.some((call) => call.method === "POST" && String(call.url).includes("/issues/")),
    false,
  )
})

test("a model outage does not fail a low-risk review", async () => {
  const missed = await summarize({
    apiKey: "",
    comment: "hello",
    fetchImpl: async () => {
      throw new Error("should not be called")
    },
  })
  assert.deepEqual(missed, { summary: "", error: "" })

  const failed = await summarize({
    apiKey: "sk-test",
    comment: "hello",
    fetchImpl: async () => jsonResponse({ error: "no" }, 401),
  })
  assert.equal(failed.summary, "")
  assert.equal(failed.error, "HTTP 401")
})

test("finds the sticky comment and ignores other comments", () => {
  const found = findExistingComment([
    { id: 1, body: "nice" },
    { id: 2, body: "<!-- agent-gate -->\n## Agent Gate" },
  ])
  assert.equal(found.id, 2)
  assert.equal(findExistingComment([{ id: 1, body: "no marker" }]), null)
})

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}
