const title = document.querySelector("#org-title")
const summary = document.querySelector("#org-summary")
const limits = document.querySelector("#org-limits")
const repoList = document.querySelector("#repo-list")
const errorNote = document.querySelector("#org-error")
const findingTitle = document.querySelector("#finding-title")
const findingNote = document.querySelector("#finding-note")
const findingList = document.querySelector("#finding-list")

let selected = ""

load()

async function load() {
  let data
  try {
    const response = await fetch("./data/org.json")
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    data = await response.json()
  } catch (error) {
    errorNote.hidden = false
    errorNote.textContent = "The organization sample could not be loaded."
    summary.textContent = error.message
    return
  }
  const repos = data.repos || []
  const total = repos.reduce((count, repo) => count + (repo.findings || []).length, 0)
  title.textContent = data.account || "Organization"
  summary.textContent = `${repos.length} repositories. ${total} findings in the files this sample read.`
  limits.textContent = (data.notScanned || []).map((item) => `${item.name}: ${item.why}`).join(" ")
  if (!repos.length) {
    repoList.textContent = "No repositories were in this sample."
    return
  }
  for (const repo of repos) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "repo"
    const count = (repo.findings || []).length
    button.innerHTML = `<strong></strong><span></span>`
    button.querySelector("strong").textContent = repo.name
    button.querySelector("span").textContent = repo.error ? "Could not read" : count === 1 ? "1 finding" : count ? `${count} findings` : "No findings"
    button.addEventListener("click", () => show(repo, button))
    repoList.append(button)
  }
  show(repos[0], repoList.querySelector("button"))
}

function show(repo, button) {
  selected = repo.fullName
  for (const item of repoList.querySelectorAll("button")) {
    item.setAttribute("aria-pressed", item === button ? "true" : "false")
  }
  findingTitle.textContent = repo.name
  if (repo.error) {
    findingNote.textContent = repo.error
    findingList.replaceChildren()
    return
  }
  const findings = repo.findings || []
  findingNote.textContent = findings.length
    ? `${findings.length} findings. The fix is a review note, not an automatic code change.`
    : "No findings in the files this sample read."
  findingList.replaceChildren()
  if (!findings.length) return
  const list = document.createElement("ul")
  list.className = "finding-list"
  for (const finding of findings) {
    const item = document.createElement("li")
    const heading = document.createElement("strong")
    heading.textContent = finding.title
    const meta = document.createElement("p")
    meta.textContent = [finding.severity, finding.kind, finding.filename].filter(Boolean).join(" · ")
    const fix = document.createElement("p")
    fix.textContent = finding.fix || ""
    item.append(heading, meta, fix)
    list.append(item)
  }
  findingList.append(list)
}
