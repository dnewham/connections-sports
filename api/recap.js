export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt" });
  }

  const headers = {
    "Content-Type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  };

  const tools = [{ type: "web_search_20250305", name: "web_search" }];

  try {
    const messages = [{ role: "user", content: prompt }];

    // Agentic loop — keep going until Claude stops using tools
    let iterations = 0;
    while (iterations < 10) {
      iterations++;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          tools,
          messages,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: err.error?.message || "API error" });
      }

      const data = await response.json();
      const content = data.content || [];

      // Add Claude's response to the message history
      messages.push({ role: "assistant", content });

      // If Claude is done (no more tool calls), extract and return the text
      if (data.stop_reason === "end_turn") {
        const text = content
          .filter(b => b.type === "text")
          .map(b => b.text)
          .join("")
          .trim() || "Could not generate recap.";
        return res.status(200).json({ text });
      }

      // If Claude wants to use tools, process each tool_use block
      if (data.stop_reason === "tool_use") {
        const toolUseBlocks = content.filter(b => b.type === "tool_use");
        const toolResults = [];

        for (const toolUse of toolUseBlocks) {
          if (toolUse.name === "web_search") {
            // The web_search tool result is already included in the response
            // by Anthropic's API — we just need to pass it back
            // Find the corresponding tool_result in content if present
            const resultBlock = content.find(
              b => b.type === "tool_result" && b.tool_use_id === toolUse.id
            );
            if (resultBlock) {
              toolResults.push(resultBlock);
            } else {
              // Shouldn't happen with server-side web search, but handle gracefully
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "Search results not available.",
              });
            }
          }
        }

        // Add tool results as a user message to continue the conversation
        if (toolResults.length > 0) {
          messages.push({ role: "user", content: toolResults });
        } else {
          // No tool results to add — break to avoid infinite loop
          break;
        }
      } else {
        // Unknown stop reason — break
        break;
      }
    }

    // Fallback: extract any text from the last assistant message
    const lastAssistant = messages.filter(m => m.role === "assistant").pop();
    const text = (lastAssistant?.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim() || "Could not generate recap.";

    return res.status(200).json({ text });

  } catch (e) {
    return res.status(500).json({ error: e.message || "Unknown error" });
  }
}
