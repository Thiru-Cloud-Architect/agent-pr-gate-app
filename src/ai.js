export async function summarize({ apiKey, model, comment, baseUrl, fetchImpl }) {
  if (!apiKey) return { summary: "", error: "" }
  const root = (baseUrl || "https://api.openai.com/v1").replace(/\/$/, "")
  const usedModel = model || "gpt-4o-mini"
  try {
    const response = await fetchImpl(`${root}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: usedModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "You write four sentences for the engineer reviewing this pull request. Use only facts already in the comment. Do not invent resources, owners, outages, or a different risk level.",
          },
          { role: "user", content: comment },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!response.ok) return { summary: "", error: `HTTP ${response.status}` }
    const json = await response.json()
    const text = json.choices?.[0]?.message?.content?.trim() || ""
    if (!text) return { summary: "", error: "empty model response" }
    return { summary: text, error: "" }
  } catch (error) {
    return { summary: "", error: error?.name === "TimeoutError" ? "timed out" : "request failed" }
  }
}
