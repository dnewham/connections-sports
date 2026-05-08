export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, puzzles } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  try {
    // Step 1: Look up categories one puzzle at a time with delays between each
    const categoryLines = [];

    if (puzzles && puzzles.length > 0) {
      for (const puzzle of puzzles) {
        try {
          const searchPrompt = `What are the four category names (yellow, green, blue, purple) for NYT Connections Sports Edition puzzle #${puzzle.num} on ${puzzle.date}? Reply in one line only: "Yellow: X, Green: Y, Blue: Z, Purple: W". If unknown, reply "Not found".`;

          const searchResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 150,
              tools: [{ type: "web_search_20250305", name: "web_search" }],
              messages: [{ role: "user", content: searchPrompt }],
            }),
          });

          if (searchResponse.ok) {
            const searchData = await searchResponse.json();
            const textBlocks = (searchData.content || []).filter(b => b.type === "text");
            const result = textBlocks.map(b => b.text).join("").trim();
            if (result && !result.toLowerCase().includes("not found")) {
              categoryLines.push(`Puzzle #${puzzle.num} (${puzzle.date}): ${result}`);
            }
          }
        } catch (e) {
          // Skip this puzzle if search fails
        }

        // Wait between each puzzle search to stay under rate limits
        await sleep(10000);
      }
    }

    // Step 2: Generate recap with category context appended
    const categoryContext = categoryLines.join("\n");
    const fullPrompt = categoryContext
      ? `${prompt}\n\nPUZZLE CATEGORIES (weave into commentary):\n${categoryContext}`
      : prompt;

    const recapResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
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
