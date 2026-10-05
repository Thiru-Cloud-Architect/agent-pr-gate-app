const title = document.querySelector("#org-title")
const summary = document.querySelector("#org-summary")
const limits = document.querySelector("#org-limits")
const stats = document.querySelector("#stats")
const filters = document.querySelector("#filters")
const repoRows = document.querySelector("#repo-rows")
const errorNote = document.querySelector("#org-error")
const findingTitle = document.querySelector("#finding-title")
const findingNote = document.querySelector("#finding-note")
const findingList = document.querySelector("#finding-list")

const FILTERS = [
  { id: "all", label: "All" },
  { id: "high", label: "High" },
  { id: "secret", label: "Secrets" },
  { id: "code", label: "Code" },
  { id: "dependency", label: "Packages" },
  { id: "infrastructure", label: "Infrastructure" },
  { id: "container", label: "Containers" },
  { id: "practice", label: "Tests" },
]

let repos = []
let filter = "all"
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
  repos = data.repos || []
  title.textContent = data.account || "Portfolio"
  const total = repos.reduce((count, repo) => count + (repo.findings || []).length, 0)
  const when = data.scannedAt ? ` Scanned ${data.scannedAt}.` : ""
  summary.textContent = `${repos.length} repositories. ${total} findings in the files this sample read.${when}`
  limits.textContent = (data.notScanned || []).map((item) => `${item.name}: ${item.why}`).join(" ")
  renderStats()
  renderFilters()
  const first = [...repos].sort(byHeat)[0]
  selected = first ? first.fullName : ""
  renderRepos()
}

function renderStats() {
  const findings = repos.flatMap((repo) => repo.findings || [])
  const high = findings.filter((item) => item.severity === "high" || item.severity === "critical").length
  const medium = findings.filter((item) => item.severity === "medium").length
  const clean = repos.filter((repo) => !(repo.findings || []).length && !repo.error).length
  stats.replaceChildren()
  for (const item of [
    ["Repositories", String(repos.length)],
    ["High", String(high)],
    ["Medium", String(medium)],
    ["Clean", String(clean)],
  ]) {
    const card = document.createElement("div")
    card.className = "stat"
    const value = document.createElement("strong")
    value.textContent = item[1]
    const label = document.createElement("span")
    label.textContent = item[0]
    card.append(value, label)
    stats.append(card)
  }
}

function renderFilters() {
  filters.replaceChildren()
  for (const item of FILTERS) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "filter"
    button.textContent = item.label
    button.setAttribute("aria-pressed", item.id === filter ? "true" : "false")
    button.addEventListener("click", () => {
      filter = item.id
      renderFilters()
      renderRepos()
    })
    filters.append(button)
  }
}

function renderRepos() {
  repoRows.replaceChildren()
  const shown = [...repos].filter((repo) => matching(repo).length || (filter === "all" && !repo.error)).sort(byHeat)
  if (!shown.length) {
    const row = document.createElement("tr")
    const cell = document.createElement("td")
    cell.colSpan = 4
    cell.textContent = "No repositories match this filter."
    row.append(cell)
    repoRows.append(row)
    findingTitle.textContent = "Findings"
    findingNote.textContent = "No repositories match this filter."
    findingList.replaceChildren()
    return
  }
  if (!shown.some((repo) => repo.fullName === selected)) selected = shown[0].fullName
  for (const repo of shown) {
    const row = document.createElement("tr")
    if (repo.fullName === selected) row.className = "is-selected"
    const name = document.createElement("th")
    name.scope = "row"
    const button = document.createElement("button")
    button.type = "button"
    button.className = "repo-name"
    button.textContent = repo.name
    button.setAttribute("aria-pressed", repo.fullName === selected ? "true" : "false")
    button.addEventListener("click", () => {
      selected = repo.fullName
      renderRepos()
    })
    name.append(button)
    const tally = count(repo)
    const high = document.createElement("td")
    high.textContent = String(tally.high)
    const medium = document.createElement("td")
    medium.textContent = String(tally.medium)
    const open = document.createElement("td")
    open.textContent = repo.error ? "Could not read" : tally.open === 1 ? "1 finding" : `${tally.open} findings`
    row.append(name, high, medium, open)
    repoRows.append(row)
  }
  show(shown.find((repo) => repo.fullName === selected))
}

function show(repo) {
  if (!repo) return
  findingTitle.textContent = repo.name
  if (repo.error) {
    findingNote.textContent = repo.error
    findingList.replaceChildren()
    return
  }
  const findings = matching(repo)
  findingNote.textContent = findings.length
    ? `${findings.length} shown. The fix is a review note, not an automatic code change.`
    : "No findings in the files this sample read."
  findingList.replaceChildren()
  if (!findings.length) return
  const table = document.createElement("table")
  table.className = "portfolio"
  const head = document.createElement("thead")
  const headRow = document.createElement("tr")
  for (const label of ["Severity", "Finding", "File", "Fix"]) {
    const cell = document.createElement("th")
    cell.textContent = label
    headRow.append(cell)
  }
  head.append(headRow)
  const body = document.createElement("tbody")
  for (const finding of findings) {
    const row = document.createElement("tr")
    const severity = document.createElement("td")
    const pill = document.createElement("span")
    pill.className = `pill ${finding.severity || "medium"}`
    pill.textContent = finding.severity || "note"
    severity.append(pill)
    const name = document.createElement("td")
    name.textContent = finding.title || ""
    const file = document.createElement("td")
    const path = document.createElement("code")
    path.textContent = finding.filename || ""
    file.append(path)
    const fix = document.createElement("td")
    fix.textContent = finding.fix || ""
    row.append(severity, name, file, fix)
    body.append(row)
  }
  table.append(head, body)
  findingList.append(table)
}

function matching(repo) {
  const findings = repo.findings || []
  if (filter === "all") return findings
  if (filter === "high") return findings.filter((item) => item.severity === "high" || item.severity === "critical")
  return findings.filter((item) => item.kind === filter)
}

function count(repo) {
  const findings = matching(repo)
  return {
    high: findings.filter((item) => item.severity === "high" || item.severity === "critical").length,
    medium: findings.filter((item) => item.severity === "medium").length,
    open: findings.length,
  }
}

function byHeat(left, right) {
  const a = count(left)
  const b = count(right)
  return b.high - a.high || b.medium - a.medium || left.name.localeCompare(right.name)
}
