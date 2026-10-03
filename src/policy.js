// YAML reader for the Agent Gate policy shape.
// Supports comments, scalars, nested maps, and lists of scalars or maps.

export const defaultPolicyText = `version: 1
paths:
  - path: "**/*.tf"
    service: terraform
    risk: medium
  - path: "**/*.tfvars"
    service: terraform
    risk: medium
  - path: "**/values.yaml"
    service: helm
    risk: medium
  - path: "**/values-*.yaml"
    service: helm
    risk: medium
  - path: "**/templates/**"
    service: helm
    risk: medium
  - path: "**/prod/**"
    service: inferred
    environment: production
    risk: high
  - path: "**/production/**"
    service: inferred
    environment: production
    risk: high
agents: []
`

export function parsePolicy(text) {
  const lines = String(text).split(/\r?\n/)
  const root = {}
  const stack = [{ indent: -1, container: root, kind: "map" }]

  function current() {
    return stack[stack.length - 1]
  }

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const indent = raw.match(/^ */)[0].length
    while (stack.length > 1 && indent <= current().indent) stack.pop()
    const parent = current()

    if (trimmed.startsWith("- ")) {
      if (parent.kind !== "list") {
        throw new Error(`Line ${index + 1}: list item is not under a list (${trimmed})`)
      }
      const rest = trimmed.slice(2).trim()
      const kv = rest ? splitKv(rest) : null
      if (!rest) {
        const obj = {}
        parent.container.push(obj)
        stack.push({ indent, container: obj, kind: "map" })
      } else if (kv && !kv.inline) {
        const obj = {}
        parent.container.push(obj)
        stack.push({ indent, container: obj, kind: "map" })
        openEmpty(obj, kv.key, lines, index, indent, stack)
      } else if (kv) {
        const obj = { [kv.key]: kv.value }
        parent.container.push(obj)
        stack.push({ indent, container: obj, kind: "map" })
      } else {
        parent.container.push(parseScalar(rest))
      }
      continue
    }

    if (parent.kind !== "map") {
      throw new Error(`Line ${index + 1}: expected a key inside a map (${trimmed})`)
    }
    const kv = splitKv(trimmed)
    if (!kv) throw new Error(`Line ${index + 1}: cannot read this line (${trimmed})`)
    if (kv.inline) {
      parent.container[kv.key] = kv.value
    } else {
      openEmpty(parent.container, kv.key, lines, index, indent, stack)
    }
  }

  return normalizePolicy(root)
}

function openEmpty(container, key, lines, index, keyIndent, stack) {
  const next = nextContent(lines, index)
  if (next && next.indent > keyIndent && next.text.startsWith("- ")) {
    const list = []
    container[key] = list
    stack.push({ indent: keyIndent, container: list, kind: "list" })
    return
  }
  if (next && next.indent > keyIndent) {
    const obj = {}
    container[key] = obj
    stack.push({ indent: keyIndent, container: obj, kind: "map" })
    return
  }
  container[key] = ""
}

function splitKv(line) {
  const idx = line.indexOf(":")
  if (idx === -1) return null
  const key = line.slice(0, idx).trim()
  if (!key || /\s/.test(key)) return null
  const rest = line.slice(idx + 1).trim()
  if (!rest || rest === "|" || rest === ">") return { key, value: null, inline: false }
  return { key, value: parseScalar(rest), inline: true }
}

function parseScalar(value) {
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1)
  }
  if (value === "true") return true
  if (value === "false") return false
  if (value === "null" || value === "~") return null
  if (/^-?\d+$/.test(value)) return Number(value)
  return value
}

function nextContent(lines, index) {
  for (let i = index + 1; i < lines.length; i++) {
    const text = lines[i].trim()
    if (!text || text.startsWith("#")) continue
    return { indent: lines[i].match(/^ */)[0].length, text, index: i }
  }
  return null
}

function normalizePolicy(root) {
  const paths = Array.isArray(root.paths) ? root.paths : []
  const agents = Array.isArray(root.agents) ? root.agents : []
  return {
    version: root.version ?? 1,
    paths: paths.map(normalizePath),
    agents: agents.map(normalizeAgent),
  }
}

function normalizePath(entry) {
  if (!entry || typeof entry !== "object" || !entry.path) {
    throw new Error("Each paths entry needs a path")
  }
  return {
    path: String(entry.path),
    service: entry.service ? String(entry.service) : "inferred",
    namespace: entry.namespace ? String(entry.namespace) : "",
    environment: entry.environment ? String(entry.environment) : "",
    risk: normalizeRisk(entry.risk || "medium"),
  }
}

function normalizeAgent(entry) {
  if (!entry || typeof entry !== "object" || !entry.name) {
    throw new Error("Each agents entry needs a name")
  }
  return {
    name: String(entry.name),
    actors: asList(entry.actors),
    allow: asList(entry.allow),
    deny: asList(entry.deny),
  }
}

function asList(value) {
  if (value == null || value === "") return []
  if (Array.isArray(value)) return value.map(String)
  return [String(value)]
}

function normalizeRisk(risk) {
  const value = String(risk).toLowerCase()
  if (value === "low" || value === "medium" || value === "high") return value
  return "medium"
}

export function matchGlob(glob, filename) {
  return globToRegExp(String(glob)).test(String(filename))
}

export function globToRegExp(glob) {
  let body = ""
  let i = 0
  while (i < glob.length) {
    if (glob[i] === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        body += "(?:.*/)?"
        i += 3
        continue
      }
      body += ".*"
      i += 2
      continue
    }
    if (glob[i] === "*") {
      body += "[^/]*"
      i += 1
      continue
    }
    if ("\\^$+?.()|{}[]".includes(glob[i])) {
      body += `\\${glob[i]}`
      i += 1
      continue
    }
    body += glob[i]
    i += 1
  }
  return new RegExp(`^${body}$`)
}
