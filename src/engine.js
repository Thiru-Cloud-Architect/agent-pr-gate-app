import { defaultPolicyText, matchGlob, parsePolicy } from "./policy.js"
import { renderComment } from "./comment.js"

const RISK_RANK = { low: 1, medium: 2, high: 3 }

export function evaluate(input) {
  const policyText = input.policyText || defaultPolicyText
  const policy = input.policy || parsePolicy(policyText)
  const files = (input.files || []).map(normalizeFile)
  const actor = input.actor || "unknown"
  const actorType = input.actorType || (isBot(actor) ? "Bot" : "User")
  const identity = identify(actor, actorType, policy)
  const surfaces = files.flatMap((file) => surfacesFor(file, policy))
  const askHuman = questionsFor(files)
  const denied = identity.role === "agent" ? deniedFiles(files, identity.agent) : []
  const outsideAllow = identity.role === "agent" ? outsideAllowFiles(files, identity.agent) : []

  let risk = "low"
  for (const surface of surfaces) risk = maxRisk(risk, surface.risk)
  if (denied.length > 0) risk = maxRisk(risk, "high")
  if (askHuman.length > 0 && files.some(isInfraFile)) risk = maxRisk(risk, "medium")
  if (surfaces.length === 0 && files.length > 0 && files.every(isDocFile)) risk = "low"

  const verdict = decideVerdict({ identity, denied, outsideAllow, risk })
  const breaks = breakLines(surfaces, files)
  const rollback = rollbackLines(files)
  const revoke = revokeBlock({ identity, actor, files, denied, surfaces })
  const evidence = evidenceLines({ files, surfaces, identity, denied, outsideAllow, actor })

  const report = {
    actor,
    actorType,
    identity: {
      role: identity.role,
      name: identity.agent?.name || "",
      listed: identity.listed,
    },
    verdict,
    risk,
    surfaces,
    breaks,
    rollback,
    revoke,
    askHuman,
    evidence,
    policyMissing: Boolean(input.policyMissing),
    failOnRisk: input.failOnRisk === "high" ? "high" : "never",
    modelSummary: input.modelSummary || "",
    modelError: input.modelError || "",
  }
  report.comment = renderComment(report)
  return report
}

export function shouldFail(report) {
  return report.failOnRisk === "high" && report.risk === "high"
}

export function highestRisk(files, policy) {
  let risk = "low"
  for (const file of files) {
    for (const surface of surfacesFor(normalizeFile(file), policy)) {
      risk = maxRisk(risk, surface.risk)
    }
  }
  return risk
}

function normalizeFile(file) {
  return {
    filename: String(file.filename || ""),
    status: file.status || "modified",
    patch: file.patch || "",
    previousFilename: file.previousFilename || file.previous_filename || "",
  }
}

function identify(actor, actorType, policy) {
  const agent = policy.agents.find((entry) => entry.actors.some((listed) => sameActor(listed, actor)))
  if (agent) return { role: "agent", agent, listed: true }
  if (actorType === "Bot" || isBot(actor)) return { role: "agent", agent: null, listed: false }
  return { role: "human", agent: null, listed: false }
}

function sameActor(listed, actor) {
  const left = String(listed).toLowerCase()
  const right = String(actor).toLowerCase()
  if (left === right) return true
  return stripBot(left) === stripBot(right) && stripBot(left).length > 0
}

function stripBot(value) {
  return value.replace(/\[bot\]$/, "")
}

function isBot(actor) {
  return /\[bot\]$/i.test(actor) || actor.endsWith("-bot")
}

function surfacesFor(file, policy) {
  const hits = policy.paths.filter((rule) => matchGlob(rule.path, file.filename))
  if (hits.length === 0) return []
  const chosen = hits.sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || b.path.length - a.path.length)[0]
  const inferred = inferContext(file)
  return [
    {
      filename: file.filename,
      status: file.status,
      service: chosen.service === "inferred" ? inferred.service : chosen.service,
      namespace: chosen.namespace || inferred.namespace,
      environment: environmentOf(chosen, file, inferred),
      risk: chosen.risk,
      pattern: chosen.path,
    },
  ]
}

function environmentOf(rule, file, inferred) {
  if (rule.environment && rule.environment !== "inferred") return rule.environment
  return inferred.environment || "unspecified"
}

function inferContext(file) {
  const parts = file.filename.split("/").filter(Boolean)
  const skip = new Set([
    "infra",
    "deploy",
    "charts",
    "chart",
    "k8s",
    "kubernetes",
    "manifests",
    "terraform",
    "envs",
    "environments",
    "prod",
    "production",
    "staging",
    "stage",
    "dev",
    "development",
    "templates",
    "live",
  ])
  const service = parts.find((part) => !skip.has(part) && !part.includes(".")) || "unknown"
  let environment = ""
  if (parts.includes("prod") || parts.includes("production")) environment = "production"
  else if (parts.includes("staging") || parts.includes("stage")) environment = "staging"
  else if (parts.includes("dev") || parts.includes("development")) environment = "development"
  const namespace = parts.includes("prod") ? "prod" : ""
  return { service, environment, namespace }
}

function deniedFiles(files, agent) {
  if (!agent) return []
  return files.filter((file) => agent.deny.some((glob) => matchGlob(glob, file.filename)))
}

function outsideAllowFiles(files, agent) {
  if (!agent || agent.allow.length === 0) return []
  return files.filter((file) => {
    const denied = agent.deny.some((glob) => matchGlob(glob, file.filename))
    if (denied) return false
    return !agent.allow.some((glob) => matchGlob(glob, file.filename))
  })
}

function decideVerdict({ identity, denied, outsideAllow, risk }) {
  if (identity.role !== "agent") return "allowed"
  if (denied.length > 0) return "revoked"
  if (outsideAllow.length > 0) return "needs-human"
  if (!identity.listed && (risk === "high" || risk === "medium")) return "needs-human"
  if (identity.listed && risk === "high") return "needs-human"
  return "allowed"
}

function questionsFor(files) {
  const names = files.map((file) => file.filename)
  const questions = []
  const terraform = names.some((name) => name.endsWith(".tf") || name.endsWith(".tfvars"))
  const plan = names.some((name) => /tfplan\.json$|\.plan\.json$|plan\.json$/.test(name))
  if (terraform && !plan) {
    questions.push(
      "Terraform files changed and this pull request has no plan JSON. Resource names are inferred from the diff only.",
    )
  }
  const helm = names.some((name) => /(^|\/)(Chart\.yaml|values[^/]*\.yaml)$/.test(name) || name.includes("/templates/"))
  const rendered = names.some((name) => name.includes("/rendered/") || /(^|\/)rendered\.yaml$|(^|\/)manifest\.yaml$/.test(name))
  if (helm && !rendered) {
    questions.push("Helm or manifest files changed and this pull request has no rendered manifests.")
  }
  return questions
}

function breakLines(surfaces, files) {
  const byFile = new Map(files.map((file) => [file.filename, file]))
  return surfaces.map((surface) => {
    const file = byFile.get(surface.filename)
    const signal = file ? signalText(file) : ""
    const where = [surface.service, surface.environment].filter((part) => part && part !== "unspecified").join(" in ")
    const lead = where ? `${where}: ` : ""
    if (signal) return `${lead}${signal} (\`${surface.filename}\`).`
    return `${lead}\`${surface.filename}\` was ${surface.status}.`
  })
}

function signalText(file) {
  const patch = file.patch || ""
  const oldClass = patch.match(/^-\s*instance_class\s*=\s*"([^"]+)"/m)
  const newClass = patch.match(/^\+\s*instance_class\s*=\s*"([^"]+)"/m)
  if (oldClass && newClass) {
    return `database class changes from \`${oldClass[1]}\` to \`${newClass[1]}\``
  }
  const oldReplicas = patch.match(/^-\s*replicaCount:\s*(\d+)/m)
  const newReplicas = patch.match(/^\+\s*replicaCount:\s*(\d+)/m)
  if (oldReplicas && newReplicas) {
    return `replica count changes from ${oldReplicas[1]} to ${newReplicas[1]}`
  }
  const resource = patch.match(/^[ +\-]*resource\s+"([^"]+)"\s+"([^"]+)"/m)
  if (resource && (patch.includes("\n+") || patch.startsWith("+"))) {
    return `Terraform resource \`${resource[1]}.${resource[2]}\` is in the diff`
  }
  const kind = patch.match(/^[ +\-]*kind:\s*(\S+)/m)
  const meta = patch.match(/^[ +\-]*name:\s*(\S+)/m)
  if (kind) {
    const name = meta ? ` \`${meta[1]}\`` : ""
    return `Kubernetes ${kind[1]}${name} is in the diff`
  }
  return ""
}

function rollbackLines(files) {
  const lines = ["Revert this pull request. Do not merge the agent commit and redeploy from this branch."]
  if (files.some((file) => file.filename.endsWith(".tf") || file.filename.endsWith(".tfvars"))) {
    lines.push("Do not run `terraform apply` from this branch. Generate the next plan from `main` after the revert.")
  }
  if (files.some((file) => /(^|\/)values[^/]*\.yaml$/.test(file.filename) || file.filename.endsWith("Chart.yaml"))) {
    lines.push("Redeploy the previous Helm values from `main`. Do not run `helm upgrade` or `helm install` from this branch.")
  }
  if (files.some((file) => file.filename.includes("/templates/") || file.filename.endsWith(".yaml"))) {
    const already = lines.some((line) => line.includes("Helm"))
    if (!already) {
      lines.push("Re-apply the previous manifest from `main`. Do not run `kubectl apply` for this diff.")
    }
  }
  return lines
}

function revokeBlock({ identity, actor, files, denied, surfaces }) {
  if (identity.role === "human") {
    return {
      prose: "This actor is a human. Revoke applies to agents. Add an `agents` entry only if this login is a bot the roster missed.",
      yaml: "",
    }
  }

  const prodFiles = surfaces.map((surface) => surface.filename)
  const name = identity.agent?.name || stripBot(actor) || "agent"
  const existing = identity.agent?.deny || []
  const yamlDeny = unique([...existing, ...prodFiles.map(parentGlob)])

  if (!identity.listed) {
    return {
      prose: `\`${actor}\` is not in the policy roster. Add an agent entry that denies the production paths from this pull request. That is the kill switch.`,
      yaml: agentYaml(name, actor, yamlDeny),
    }
  }

  if (denied.length > 0) {
    const deniedNames = denied.map((file) => `\`${file.filename}\``).join(", ")
    const extra = prodFiles.filter((filename) => !denied.some((file) => file.filename === filename))
    const prose = extra.length
      ? `\`${name}\` is already denied for ${existing.map((item) => `\`${item}\``).join(", ")}, which matches ${deniedNames}. These other production files are not in the deny list: ${extra.map((item) => `\`${item}\``).join(", ")}. Add them, then this agent cannot open the same door again.`
      : `\`${name}\` is already denied for ${existing.map((item) => `\`${item}\``).join(", ")}, which matches ${deniedNames}. Leave the deny in place.`
    return { prose, yaml: agentYaml(name, actor, yamlDeny) }
  }

  if (prodFiles.length === 0) {
    return {
      prose: "Nothing in this diff matches a production path, so there is nothing new to revoke.",
      yaml: "",
    }
  }

  return {
    prose: `\`${name}\` can still change production paths. Add a deny list. The next pull request from this agent fails the verdict before merge.`,
    yaml: agentYaml(name, actor, yamlDeny),
  }
}

function agentYaml(name, actor, deny) {
  const denies = (deny.length ? deny : ["infra/prod/**"]).map((item) => `        - ${item}`).join("\n")
  return [`    - name: ${name}`, `      actors:`, `        - ${actor}`, `      deny:`, denies].join("\n")
}

function parentGlob(filename) {
  const parts = filename.split("/")
  if (parts.length === 1) return filename
  parts.pop()
  return `${parts.join("/")}/**`
}

function evidenceLines({ files, surfaces, identity, denied, outsideAllow, actor }) {
  if (files.length === 0) return ["The pull request has no changed files."]
  const surfaceByFile = new Map(surfaces.map((surface) => [surface.filename, surface]))
  return files.map((file) => {
    const surface = surfaceByFile.get(file.filename)
    const bits = [`\`${file.filename}\` ${file.status}`]
    if (surface) bits.push(`matched \`${surface.pattern}\` (${surface.risk})`)
    else bits.push("matched no production path")
    if (denied.some((item) => item.filename === file.filename)) {
      bits.push(`agent \`${identity.agent?.name || stripBot(actor) || "unlisted"}\` deny`)
    }
    else if (outsideAllow.some((item) => item.filename === file.filename)) bits.push("outside the agent allow list")
    else if (identity.role === "agent" && identity.agent?.allow.some((glob) => matchGlob(glob, file.filename))) {
      bits.push("inside the agent allow list")
    }
    return bits.join(", ")
  })
}

function isInfraFile(file) {
  return (
    file.filename.endsWith(".tf") ||
    file.filename.endsWith(".tfvars") ||
    /(^|\/)values[^/]*\.yaml$/.test(file.filename) ||
    file.filename.includes("/templates/") ||
    file.filename.includes("/prod/")
  )
}

function isDocFile(file) {
  return file.filename.endsWith(".md") || file.filename.startsWith("docs/") || file.filename.includes("/docs/")
}

function maxRisk(left, right) {
  return RISK_RANK[right] > RISK_RANK[left] ? right : left
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}
