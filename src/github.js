import { MARKER } from "./comment.js"

export function findExistingComment(comments) {
  return (comments || []).find((comment) => typeof comment.body === "string" && comment.body.includes(MARKER)) || null
}

export async function fetchPullFiles({ repository, number, token, fetchImpl }) {
  const files = []
  let page = 1
  while (page <= 5) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`,
      { headers: githubHeaders(token) },
    )
    if (!response.ok) {
      throw new Error(`GitHub file list returned HTTP ${response.status}`)
    }
    const batch = await response.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const file of batch) {
      files.push({
        filename: file.filename,
        status: file.status,
        patch: file.patch || "",
        previousFilename: file.previous_filename || "",
      })
    }
    if (batch.length < 100) break
    page += 1
  }
  return files
}

export async function upsertComment({ repository, number, token, body, fetchImpl }) {
  const list = await fetchImpl(
    `https://api.github.com/repos/${repository}/issues/${number}/comments?per_page=100`,
    { headers: githubHeaders(token) },
  )
  if (!list.ok) throw new Error(`GitHub comment list returned HTTP ${list.status}`)
  const existing = findExistingComment(await list.json())
  if (existing) {
    const update = await fetchImpl(`https://api.github.com/repos/${repository}/issues/comments/${existing.id}`, {
      method: "PATCH",
      headers: githubHeaders(token),
      body: JSON.stringify({ body }),
    })
    if (!update.ok) throw new Error(`GitHub comment update returned HTTP ${update.status}`)
    return "updated"
  }
  const create = await fetchImpl(`https://api.github.com/repos/${repository}/issues/${number}/comments`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({ body }),
  })
  if (!create.ok) throw new Error(`GitHub comment create returned HTTP ${create.status}`)
  return "created"
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "agent-gate",
  }
}
