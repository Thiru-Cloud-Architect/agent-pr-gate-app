import rules from "../scanner/rules.json" with { type: "json" }

export function scanFiles(files, extraFindings = []) {
  const secrets = []
  const code = []
  const dependencies = []
  const infrastructure = []
  const containers = []
  for (const file of files || []) {
    const text = addedText(file)
    scanPatterns(file.filename, text, rules.secrets, secrets, "secret")
    scanPatterns(file.filename, text, rules.code, code, "code")
    scanPatterns(file.filename, text, rules.infrastructure || [], infrastructure, "infrastructure")
    scanPatterns(file.filename, text, rules.containers || [], containers, "container")
    for (const dependency of dependenciesIn(file.filename, text)) {
      for (const advisory of rules.advisories) {
        if (advisory.ecosystem === dependency.ecosystem && advisory.name === dependency.name && lowerThan(dependency.version, advisory.below)) {
          dependencies.push(dependencyFinding(file.filename, dependency, advisory))
        }
      }
    }
  }
  for (const finding of extraFindings || []) {
    pushUnique(bucket(finding, { secrets, code, dependencies, infrastructure, containers }), finding)
  }
  return { secrets, code, dependencies, infrastructure, containers, practices: practiceFindings(files) }
}

function bucket(finding, groups) {
  if (finding.kind === "secret") return groups.secrets
  if (finding.kind === "dependency") return groups.dependencies
  if (finding.kind === "infrastructure") return groups.infrastructure
  if (finding.kind === "container") return groups.containers
  return groups.code
}

function practiceFindings(files) {
  const names = (files || []).map((file) => file.filename).filter(Boolean)
  const sources = names.filter(isAppSource)
  const tests = names.filter(isTestFile)
  if (!sources.length || tests.length) return []
  return [
    {
      kind: "practice",
      id: "missing-test",
      title: "Application code changed and this diff has no test file",
      severity: "medium",
      filename: sources[0],
    },
  ]
}

function isAppSource(filename) {
  if (isTestFile(filename)) return false
  if (filename.includes("node_modules/") || filename.startsWith("site/") || filename.startsWith("scanner/")) return false
  return /\.(js|ts|py|go|java)$/.test(filename)
}

function isTestFile(filename) {
  return /(^|\/)(test|tests|__tests__)\//.test(filename) || /\.(test|spec)\.[a-z]+$/.test(filename)
}

function scanPatterns(filename, text, patterns, bucket, kind) {
  for (const rule of patterns) {
    const expression = new RegExp(rule.pattern)
    if (!expression.test(text)) continue
    pushUnique(bucket, {
      kind,
      id: rule.id,
      title: rule.title,
      severity: rule.severity,
      filename,
    })
  }
}

function dependenciesIn(filename, text) {
  const found = []
  if (filename.endsWith("package.json")) {
    const expression = /"([@A-Za-z0-9/_.-]+)":\s*"(\d+\.\d+\.\d+)"/g
    for (const match of text.matchAll(expression)) {
      found.push({ ecosystem: "npm", name: match[1], version: match[2] })
    }
  }
  if (filename.endsWith("requirements.txt")) {
    const expression = /^([A-Za-z0-9_.-]+)==(\d+\.\d+\.\d+)/gm
    for (const match of text.matchAll(expression)) {
      found.push({ ecosystem: "PyPI", name: match[1].toLowerCase(), version: match[2] })
    }
  }
  return found
}

function dependencyFinding(filename, dependency, advisory) {
  return {
    kind: "dependency",
    id: advisory.id,
    title: advisory.summary,
    summary: advisory.summary,
    severity: advisory.severity,
    filename,
    package: dependency.name,
    version: dependency.version,
    fixed: advisory.fixed || "",
  }
}

function addedText(file) {
  if (file.content) return String(file.content)
  return String(file.patch || "")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n")
}

function lowerThan(version, below) {
  const left = version.split(".").map((part) => Number(part))
  const right = below.split(".").map((part) => Number(part))
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] || 0
    const b = right[index] || 0
    if (a < b) return true
    if (a > b) return false
  }
  return false
}

function pushUnique(list, finding) {
  const key = `${finding.kind}|${finding.id}|${finding.filename}|${finding.package || ""}`
  if (list.some((item) => `${item.kind}|${item.id}|${item.filename}|${item.package || ""}` === key)) return
  list.push(finding)
}
