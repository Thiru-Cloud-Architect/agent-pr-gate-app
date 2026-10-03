import { evaluate } from "../src/engine.js"
import { samplePolicyText } from "../src/samplePolicy.js"
import { scenarios } from "../src/scenarios.js"

const form = document.querySelector("#review-form")
const actorInput = document.querySelector("#actor")
const typeInput = document.querySelector("#actor-type")
const filesInput = document.querySelector("#files")
const failInput = document.querySelector("#fail-high")
const presets = document.querySelector(".presets")
const comment = document.querySelector("#comment")
const policyView = document.querySelector("#policy-view")

policyView.textContent = samplePolicyText.trim()

for (const scenario of scenarios) {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "preset"
  button.textContent = scenario.label
  button.dataset.id = scenario.id
  button.addEventListener("click", () => applyScenario(scenario.id))
  presets.append(button)
}

let activeId = null

form.addEventListener("input", (event) => {
  if (event.target !== failInput) {
    activeId = null
    clearPressed()
  }
  draw()
})

applyScenario("agent-prod")

function applyScenario(id) {
  const scenario = scenarios.find((item) => item.id === id)
  activeId = id
  actorInput.value = scenario.input.actor
  typeInput.value = scenario.input.actorType
  filesInput.value = scenario.input.files.map((file) => file.filename).join("\n")
  for (const button of presets.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", button.dataset.id === id ? "true" : "false")
  }
  draw()
}

function clearPressed() {
  for (const button of presets.querySelectorAll("button")) button.setAttribute("aria-pressed", "false")
}

function draw() {
  const scenario = scenarios.find((item) => item.id === activeId)
  const preset = scenario && sameFiles(scenario) ? scenario : null
  const files = preset
    ? preset.input.files
    : filesInput.value
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((filename) => ({ filename, status: "modified", patch: "" }))

  let report
  try {
    report = evaluate({
      actor: actorInput.value.trim() || "unknown",
      actorType: typeInput.value,
      policyText: samplePolicyText,
      files,
      failOnRisk: failInput.checked ? "high" : "never",
    })
  } catch (error) {
    comment.replaceChildren(errorCard(error.message))
    return
  }
  comment.replaceChildren(renderCommentCard(report))
}

function sameFiles(scenario) {
  const current = filesInput.value
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
  const expected = scenario.input.files.map((file) => file.filename).join("\n")
  return current === expected && actorInput.value.trim() === scenario.input.actor && typeInput.value === scenario.input.actorType
}

function renderCommentCard(report) {
  const article = el("article", "gh")
  const header = el("header")
  header.append(el("span", "avatar", "AG"), el("strong", "", "agent-gate"), el("span", "bot-pill", "bot"))
  article.append(header)

  const body = el("div", "body")
  const verdict = el("div", "verdict")
  verdict.append(
    pill(label(report.verdict), report.verdict),
    pill(`${title(report.risk)} risk`, report.risk),
    el("span", "who", whoText(report)),
  )
  body.append(verdict)
  body.append(el("p", "", lead(report.verdict)))

  body.append(el("h3", "", "Prod surface"))
  if (report.surfaces.length === 0) {
    body.append(el("p", "", "No configured production path matched this diff."))
  } else {
    body.append(table(report.surfaces))
  }

  body.append(el("h3", "", "What can break"))
  body.append(listOr(report.breaks, "Nothing in this diff matches a production path in the policy."))

  body.append(el("h3", "", "Rollback"))
  body.append(bulletList(report.rollback))

  body.append(el("h3", "", "Revoke"))
  body.append(el("p", "", report.revoke.prose))
  if (report.revoke.yaml) body.append(el("pre", "yaml", report.revoke.yaml))

  body.append(el("h3", "", "Ask a human"))
  body.append(listOr(report.askHuman, "The diff has the artifacts this review knows how to read."))

  const job = el(
    "p",
    "job",
    report.failOnRisk === "high" && report.risk === "high"
      ? "Check: this run fails the job."
      : "Check: comment only. The job stays green.",
  )
  body.append(job)
  article.append(body)
  return article
}

function table(surfaces) {
  const wrap = document.createElement("table")
  const head = document.createElement("tr")
  for (const name of ["File", "Change", "Service", "Environment", "Risk"]) {
    head.append(el("th", "", name))
  }
  wrap.append(head)
  for (const surface of surfaces) {
    const row = document.createElement("tr")
    for (const value of [surface.filename, surface.status, surface.service, surface.environment || "—", surface.risk]) {
      row.append(el("td", "", value))
    }
    wrap.append(row)
  }
  return wrap
}

function listOr(items, empty) {
  if (!items.length) return el("p", "", empty)
  return bulletList(items)
}

function bulletList(items) {
  const list = document.createElement("ul")
  for (const item of items) list.append(el("li", "", item))
  return list
}

function errorCard(message) {
  const article = el("article", "gh")
  const body = el("div", "body")
  body.append(el("h3", "", "This review could not be built"), el("p", "", message))
  article.append(body)
  return article
}

function pill(text, kind) {
  return el("span", `pill ${kind}`, text)
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function whoText(report) {
  if (report.identity.role === "human") return `${report.actor} · human`
  if (report.identity.listed) return `${report.actor} · agent ${report.identity.name}`
  return `${report.actor} · unlisted agent`
}

function lead(verdict) {
  if (verdict === "revoked") return "This agent is denied on a production path in this pull request."
  if (verdict === "needs-human") return "A named human has to own this change before it merges."
  return "No deny rule matched. The risk note is informational."
}

function label(verdict) {
  if (verdict === "needs-human") return "Needs a named human"
  if (verdict === "revoked") return "Revoked"
  return "Allowed"
}

function title(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
