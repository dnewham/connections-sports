export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, puzzles, extractCategories, imageData } = req.body;

  const apiHeaders = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };

  try {
    // ── MODE 1: Extract categories from a screenshot image ────────────────
    if (extractCategories && imageData) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: imageData },
              },
              {
                type: "text",
                text: `This is a screenshot from the NYT Connections Sports Edition puzzle. Extract the four category names (one per color group). Return ONLY valid JSON in this exact format, no other text:
{"yellow": "CATEGORY NAME", "green": "CATEGORY NAME", "blue": "CATEGORY NAME", "purple": "CATEGORY NAME"}
If a category is not visible, use null for its value.`,
              }
            ],
          }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: err.error?.message || "API error" });
      }

      const data = await response.json();
      const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
      try {
        const categories = JSON.parse(text.replace(/```json|```/g, "").trim());
        return res.status(200).json({ categories });
      } catch {
        return res.status(200).json({ categories: null, raw: text });
      }
    }

    // ── MODE 2: Generate weekly recap ─────────────────────────────────────
    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    // Inject any stored category data passed from the client
    const fullPrompt = prompt;

    const recapResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: fullPrompt }],
      }),
    });

    if (!recapResponse.ok) {
      const err = await recapResponse.json().catch(() => ({}));
      return res.status(recapResponse.status).json({ error: err.error?.message || "API error" });
    }

    const recapData = await recapResponse.json();
    const text = (recapData.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim() || "Could not generate recap.";

    return res.status(200).json({ text });

  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
