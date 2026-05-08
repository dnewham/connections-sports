export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
          }
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || "API error" });
    }

    const data = await response.json();

    // Extract final text — response may include tool_use and tool_result blocks
    const textBlocks = (data.content || []).filter(b => b.type === "text");
    const text = textBlocks.map(b => b.text).join("").trim() || "Could not generate recap.";

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
