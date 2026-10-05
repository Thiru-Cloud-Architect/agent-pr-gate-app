import { evaluate } from "../src/engine.js"
import { samplePolicyText } from "../src/samplePolicy.js"
import { scenarios } from "../src/scenarios.js"

const form = document.querySelector("#review-form")
const actorInput = document.querySelector("#actor")
const typeInput = document.querySelector("#actor-type")
const filesInput = document.querySelector("#files")
const presets = document.querySelector(".presets")
const comment = document.querySelector("#comment")
const policyView = document.querySelector("#policy-view")
const scenarioNote = document.querySelector("#scenario-note")

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

form.addEventListener("input", () => {
  draw()
})

applyScenario("agent-prod")

function applyScenario(id) {
  const scenario = scenarios.find((item) => item.id === id)
  actorInput.value = scenario.input.actor
  typeInput.value = scenario.input.actorType
  filesInput.value = scenario.input.files.map((file) => file.filename).join("\n")
  draw()
}

function draw() {
  const preset = scenarios.find((item) => sameFiles(item)) || null
  for (const button of presets.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", preset && button.dataset.id === preset.id ? "true" : "false")
  }
  scenarioNote.textContent = preset
    ? preset.detail
    : "Custom file list. The result still uses the sample rules."
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
      failOnRisk: "never",
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
  const answer = plainAnswer(report)
  const article = el("article", "answer")
  article.append(pill(label(report.verdict), report.verdict))
  article.append(el("h3", "", answer.title))
  article.append(el("p", "answer-body", answer.body))
  article.append(el("p", "who", whoText(report)))

  article.append(el("h4", "", "What changed"))
  article.append(listOr(report.breaks, "No production file in the sample rules was changed."))
  if (report.secrets.length) {
    article.append(el("h4", "", "Secrets"))
    article.append(bulletList(report.secrets.map((item) => `${item.title} in ${item.filename}. The value is not shown.`)))
  }
  if (report.dependencies.length) {
    article.append(el("h4", "", "Packages"))
    article.append(bulletList(report.dependencies.map((item) => `${item.package} ${item.version} matches ${item.id}. Upgrade to ${item.fixed}.`)))
  }
  if (report.code.length) {
    article.append(el("h4", "", "Dangerous code"))
    article.append(bulletList(report.code.map((item) => `${item.title} in ${item.filename}.`)))
  }
  if (report.infrastructure.length) {
    article.append(el("h4", "", "Infrastructure"))
    article.append(bulletList(report.infrastructure.map((item) => `${item.title} in ${item.filename}.`)))
  }
  if (report.containers.length) {
    article.append(el("h4", "", "Containers"))
    article.append(bulletList(report.containers.map((item) => `${item.title} in ${item.filename}.`)))
  }
  if (report.practices.length) {
    article.append(el("h4", "", "Tests"))
    article.append(bulletList(report.practices.map((item) => item.title)))
  }

  article.append(el("h4", "", "What you do"))
  article.append(bulletList(nextSteps(report)))
  if (report.revoke.yaml && report.verdict === "revoked") {
    article.append(el("p", "hint", "Add this to the rules so the same agent cannot open that path again."))
    article.append(el("pre", "yaml", report.revoke.yaml.trim()))
  }
  return article
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
  if (text != null) fillText(node, text)
  return node
}

function fillText(node, text) {
  const parts = String(text).split(/(`[^`\n]+`)/g)
  if (parts.length === 1) {
    node.textContent = text
    return
  }
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const code = document.createElement("code")
      code.textContent = part.slice(1, -1)
      node.append(code)
    } else if (part) {
      node.append(document.createTextNode(part))
    }
  }
}

function whoText(report) {
  if (report.identity.role === "human") return `Opened by ${report.actor}, a person`
  if (report.identity.listed) return `Opened by ${report.actor}, an agent you listed`
  return `Opened by ${report.actor}, a bot you have not listed`
}

function plainAnswer(report) {
  if (report.secrets.length) {
    return {
      title: "A secret is in this pull request.",
      body: "Remove it and rotate it. The comment names the file and does not repeat the secret.",
    }
  }
  if (report.verdict === "revoked") {
    return {
      title: "Do not merge this.",
      body: `${report.actor} changed production files it is not allowed to touch.`,
    }
  }
  if (report.verdict === "needs-human") {
    return {
      title: "A person should review this before merge.",
      body: report.identity.listed
        ? `${report.actor} changed production files outside the list it is allowed to edit.`
        : `${report.actor} is not on your agent list, and it changed production files.`,
    }
  }
  if (report.identity.role === "human") {
    return {
      title: report.surfaces.length ? "A person changed production." : "A person opened this.",
      body: report.surfaces.length
        ? "The comment records the risk. You still decide whether to merge."
        : "They did not change a production path in the rules.",
    }
  }
  return {
    title: "This agent stayed in bounds.",
    body: "It only changed files it is allowed to edit.",
  }
}

function nextSteps(report) {
  const steps = []
  if (report.secrets.length) steps.push("Delete the secret from the branch and rotate it.")
  if (report.dependencies.length) steps.push("Upgrade the package named in the comment.")
  if (report.code.length) steps.push("Remove the dangerous call, or have a person accept it.")
  if (report.infrastructure.length) steps.push("Tighten the infrastructure change before merge.")
  if (report.containers.length) steps.push("Pin the image, and do not run it as root unless you mean to.")
  if (report.practices.length) steps.push("Add a test for the code in this pull request.")
  if (report.verdict === "revoked") {
    steps.push("Leave the pull request unmerged.", "Update the rules so those production paths are denied for this agent.")
  } else if (report.verdict === "needs-human") {
    steps.push("Ask a named person to review this before merge.")
  }
  if (steps.length) return steps
  if (report.surfaces.length) return ["Read the production note, then merge if you agree."]
  return ["You can merge it. Nothing in the rules marks these files as production."]
}

function label(verdict) {
  if (verdict === "needs-human") return "Needs a person"
  if (verdict === "revoked") return "Blocked"
  return "Allowed"
}
