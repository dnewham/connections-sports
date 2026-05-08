// Helper: build Technobezz URL from puzzle number and date string (YYYY-MM-DD)
function buildTechnobezzUrl(puzzleNum, dateStr) {
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const d = new Date(dateStr + "T12:00:00");
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  return `https://www.technobezz.com/news/nyt-connections-sports-edition-${puzzleNum}-hints-and-answers-for-${month}-${day}-${year}`;
}

// Helper: extract category names from Technobezz page HTML
function extractCategories(html) {
  const result = {};
  const colors = ["Yellow", "Green", "Blue", "Purple"];
  for (const color of colors) {
    // Matches: "Yellow (Category Name):" or "Yellow (Category Name)\n"
    const match = html.match(new RegExp(`\\*\\*${color}\\s*\\(([^)]+)\\)`));
    if (match) result[color.toLowerCase()] = match[1].trim();
  }
  return Object.keys(result).length >= 2 ? result : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, puzzles } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const apiHeaders = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };

  try {
    // Step 1: Fetch category names for each puzzle from Technobezz (static HTML, no JS needed)
    const categoryLines = [];
    if (puzzles && puzzles.length > 0) {
      for (const puzzle of puzzles) {
        try {
          const url = buildTechnobezzUrl(puzzle.num, puzzle.date);
          const pageRes = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; recap-bot/1.0)" }
          });
          if (pageRes.ok) {
            const html = await pageRes.text();
            const cats = extractCategories(html);
            if (cats) {
              const line = `Puzzle #${puzzle.num} (${puzzle.date}): Yellow: ${cats.yellow || "?"}, Green: ${cats.green || "?"}, Blue: ${cats.blue || "?"}, Purple: ${cats.purple || "?"}`;
              categoryLines.push(line);
            }
          }
        } catch (e) {
          // Skip this puzzle if fetch fails
        }
      }
    }

    // Step 2: Generate recap, injecting any categories we found
    const categoryContext = categoryLines.length > 0
      ? `\n\nPUZZLE CATEGORIES (weave into commentary where relevant):\n${categoryLines.join("\n")}`
      : "";

    const fullPrompt = prompt + categoryContext;

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
