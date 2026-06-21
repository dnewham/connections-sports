// Helper: build CNET URL from puzzle number and date string (YYYY-MM-DD)
function buildCnetUrl(puzzleNum, dateStr) {
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const d = new Date(dateStr + "T12:00:00");
  const month = months[d.getMonth()];
  const day = d.getDate();
  return `https://www.cnet.com/tech/gaming/todays-nyt-connections-sports-edition-hints-and-answers-for-${month}-${day}-${puzzleNum}/`;
}

// Helper: extract category names from CNET page HTML
function extractCategoriesFromHtml(html) {
  const result = {};
  const colors = ["Yellow", "Green", "Blue", "Purple"];
  for (const color of colors) {
    // CNET pattern: "Yellow group answer: CATEGORY NAME" or "Yellow: CATEGORY NAME"
    const patterns = [
      new RegExp(`${color}[^:]{0,30}answer[^:]{0,10}:\\s*([A-Z][^\\n<]{3,60})`, 'i'),
      new RegExp(`${color}\\s*(?:group)?\\s*:\\s*([A-Z][^\\n<]{3,60})`, 'i'),
      new RegExp(`"${color}"[^:]{0,30}:\\s*"([^"]{3,60})"`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        result[color.toLowerCase()] = match[1].trim().replace(/<[^>]+>/g, '').trim();
        break;
      }
    }
  }
  return Object.keys(result).length >= 2 ? result : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt, puzzles, extractCategories, imageData, imageType, testCnet } = req.body;

  const apiHeaders = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };

  try {
    // ── MODE 0: Test CNET fetch (diagnostic) ─────────────────────────────
    if (testCnet) {
      const { puzzleNum, date } = testCnet;
      const url = buildCnetUrl(puzzleNum, date);
      try {
        const pageRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
            "Accept": "text/html,application/xhtml+xml,*/*",
            "Accept-Language": "en-US,en;q=0.9",
          }
        });
        const html = await pageRes.text();
        const cats = extractCategoriesFromHtml(html);
        return res.status(200).json({ url, status: pageRes.status, htmlLength: html.length, categories: cats, snippet: html.slice(0, 500) });
      } catch(e) {
        return res.status(200).json({ url, error: e.message });
      }
    }

    // ── MODE 1: Extract categories from a screenshot image ────────────────
    if (extractCategories && imageData) {
      const mediaType = imageType || "image/jpeg";
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: apiHeaders,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 300,
          messages: [{
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageData } },
              { type: "text", text: `This is a screenshot from the NYT Connections Sports Edition puzzle. Extract the four category names (one per color group). Return ONLY valid JSON in this exact format, no other text:\n{"yellow": "CATEGORY NAME", "green": "CATEGORY NAME", "blue": "CATEGORY NAME", "purple": "CATEGORY NAME"}\nIf a category is not visible, use null for its value.` }
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
    if (!prompt) return res.status(400).json({ error: "Missing prompt" });

    // Try to fetch categories from CNET for any puzzles missing them
    const fetchedCategories = {};
    if (puzzles && puzzles.length > 0) {
      for (const puzzle of puzzles) {
        if (puzzle.hasCategories) continue; // already in Firestore, skip
        try {
          const url = buildCnetUrl(puzzle.num, puzzle.date);
          const pageRes = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
              "Accept": "text/html,application/xhtml+xml,*/*",
            }
          });
          if (pageRes.ok) {
            const html = await pageRes.text();
            const cats = extractCategoriesFromHtml(html);
            if (cats) fetchedCategories[puzzle.num] = cats;
          }
        } catch { /* skip */ }
      }
    }

    // Inject fetched categories into the prompt if we got any
    let fullPrompt = prompt;
    if (Object.keys(fetchedCategories).length > 0) {
      const catLines = Object.entries(fetchedCategories).map(([num, cats]) =>
        `Puzzle #${num}: Yellow: ${cats.yellow || "?"}, Green: ${cats.green || "?"}, Blue: ${cats.blue || "?"}, Purple: ${cats.purple || "?"}`
      ).join("\n");
      fullPrompt += `\n\nADDITIONAL PUZZLE CATEGORIES (from web, weave into commentary):\n${catLines}`;
    }

    const recapResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: fullPrompt }],
      }),
    });

    if (!recapResponse.ok) {
      const err = await recapResponse.json().catch(() => ({}));
      return res.status(recapResponse.status).json({ error: err.error?.message || "API error" });
    }

    const recapData = await recapResponse.json();
    const text = (recapData.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim() || "Could not generate recap.";
    return res.status(200).json({ text });

  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
