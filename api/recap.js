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
    // Step 1: Look up category names for each puzzle via web search
    // Use a very concise prompt to stay within token limits
    let categoryContext = "";
    if (puzzles && puzzles.length > 0) {
      const puzzleList = puzzles.map(p => `#${p.num} (${p.date})`).join(", ");
      const searchPrompt = `Find the yellow/green/blue/purple category names for these NYT Connections Sports Edition puzzles: ${puzzleList}. Return only a list like "Puzzle #NNN: Yellow: X, Green: Y, Blue: Z, Purple: W". Skip any you can't find.`;

      const searchResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: searchPrompt }],
        }),
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        const textBlocks = (searchData.content || []).filter(b => b.type === "text");
        categoryContext = textBlocks.map(b => b.text).join("").trim();
      }

      // Wait 15 seconds between calls to avoid hitting the per-minute token limit
      await sleep(15000);
    }

    // Step 2: Generate the recap, injecting category context if we got any
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
