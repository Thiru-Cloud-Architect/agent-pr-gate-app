export const MARKER = "<!-- agent-gate -->"

const VERDICT_LABEL = {
  allowed: "Allowed",
  "needs-human": "Needs a named human",
  revoked: "Revoked",
}

const VERDICT_LEAD = {
  allowed: "No deny rule matched this actor. The risk note is for the reviewer. It does not block merge unless fail-on-risk is set.",
  "needs-human": "A named human has to own this change. This agent is not denied yet. Revoke is the policy edit below.",
  revoked: "This agent is denied on a production path in this pull request. Do not let the agent merge it.",
}

export function renderComment(report) {
  const lines = [
    MARKER,
    "## Agent Gate",
    "",
    `| | |`,
    `| --- | --- |`,
    `| Verdict | ${VERDICT_LABEL[report.verdict] || report.verdict} |`,
    `| Risk | ${title(report.risk)} |`,
    `| Who | ${who(report)} |`,
    "",
    VERDICT_LEAD[report.verdict] || "",
    "",
    "### Prod surface",
    "",
  ]

  if (report.surfaces.length === 0) {
    lines.push("No configured production path matched this diff.", "")
  } else {
    lines.push("| File | Change | Service | Namespace | Environment | Risk |")
    lines.push("| --- | --- | --- | --- | --- | --- |")
    for (const surface of report.surfaces) {
      lines.push(
        `| \`${surface.filename}\` | ${surface.status} | ${cell(surface.service)} | ${cell(surface.namespace)} | ${cell(surface.environment)} | ${surface.risk} |`,
      )
    }
    lines.push("")
  }

  lines.push("### What can break", "")
  if (report.breaks.length === 0) {
    lines.push("Nothing in this diff matches a production path in the policy.", "")
  } else {
    for (const item of report.breaks) lines.push(`- ${item}`)
    lines.push("")
  }

  lines.push("### Rollback", "")
  for (const item of report.rollback) lines.push(`- ${item}`)
  lines.push("")

  lines.push("### Revoke", "")
  lines.push(report.revoke.prose, "")
  if (report.revoke.yaml) {
    lines.push("```yaml", report.revoke.yaml.trimEnd(), "```", "")
  }

  lines.push("### Ask a human", "")
  if (report.askHuman.length === 0) {
    lines.push("The diff has the artifacts this review knows how to read.", "")
  } else {
    for (const item of report.askHuman) lines.push(`- ${item}`)
    lines.push("")
  }

  lines.push("### Evidence", "")
  for (const item of report.evidence) lines.push(`- ${item}`)
  lines.push("")

  if (report.policyMissing) {
    lines.push(
      "No `.agent-gate/policy.yaml` was found. This review used built-in path rules. Add a policy file to name agents and revoke them.",
      "",
    )
  }

  if (report.modelSummary) {
    lines.push("### Plain-language summary", "", report.modelSummary.trim(), "")
  } else if (report.modelError) {
    lines.push(
      "### Plain-language summary",
      "",
      `Model call failed (${report.modelError}). The deterministic review above still stands.`,
      "",
    )
  } else {
    lines.push(
      "No model was called. To add a plain-language summary, set repository secret `BLAST_RADIUS_API_KEY` and pass `api-key: ${{ secrets.BLAST_RADIUS_API_KEY }}`. The deterministic review still posts when the key is missing.",
      "",
    )
  }

  lines.push(checkLine(report), "")
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`
}

function who(report) {
  const login = `\`${report.actor}\``
  if (report.identity.role === "human") return `${login} · human`
  if (report.identity.listed) return `${login} · agent \`${report.identity.name}\``
  return `${login} · unlisted agent`
}

function checkLine(report) {
  if (report.failOnRisk === "high" && report.risk === "high") {
    return "Check: this run fails the job because `fail-on-risk` is `high` and risk is high."
  }
  return "Check: comment only. Set `fail-on-risk: high` when a high risk should fail the job."
}

function cell(value) {
  return value ? String(value) : "—"
}

function title(value) {
  if (!value) return "—"
  return value.charAt(0).toUpperCase() + value.slice(1)
}
