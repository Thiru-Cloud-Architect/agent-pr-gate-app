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
    "## KORV",
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

  if (report.secrets?.length) {
    lines.push("### Secrets", "")
    for (const item of report.secrets) {
      lines.push(`- ${item.title} in \`${item.filename}\`. The value is not repeated here. Remove it and rotate it.`)
    }
    lines.push("")
  }
  if (report.dependencies?.length) {
    lines.push("### Dependencies", "")
    for (const item of report.dependencies) {
      const detail = item.fixed ? `Upgrade to \`${item.fixed}\`.` : item.summary
      lines.push(`- \`${item.package}\` ${item.version} matches ${item.id}. ${detail}`)
    }
    lines.push("")
  }
  if (report.code?.length) {
    lines.push("### Dangerous code", "")
    for (const item of report.code) lines.push(`- ${item.title} in \`${item.filename}\`.`)
    lines.push("")
  }
  if (report.infrastructure?.length) {
    lines.push("### Infrastructure", "")
    for (const item of report.infrastructure) lines.push(`- ${item.title} in \`${item.filename}\`.`)
    lines.push("")
  }
  if (report.containers?.length) {
    lines.push("### Containers", "")
    for (const item of report.containers) lines.push(`- ${item.title} in \`${item.filename}\`.`)
    lines.push("")
  }
  if (report.practices?.length) {
    lines.push("### Tests", "")
    for (const item of report.practices) lines.push(`- ${item.title} (\`${item.filename}\`).`)
    lines.push("")
  }

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
  const mode = report.failOnRisk || "never"
  const blocking = mode === "high" || mode === "critical"
  const groups = [report.secrets, report.dependencies, report.code, report.infrastructure, report.containers]
  const criticalFinding = groups.some((list) => (list || []).some((item) => item.severity === "high" || item.severity === "critical"))
  if (blocking && (report.verdict === "revoked" || report.risk === "high" || criticalFinding)) {
    return "Check: this run fails the job. GitHub blocks the merge only when branch protection requires this check."
  }
  return "Check: comment only. Set `fail-on-risk: critical` when a critical finding should fail the job and block merge."
}

function cell(value) {
  return value ? String(value) : "—"
}

function title(value) {
  if (!value) return "—"
  return value.charAt(0).toUpperCase() + value.slice(1)
}
