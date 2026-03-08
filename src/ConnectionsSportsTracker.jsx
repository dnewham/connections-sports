// ── Share helper ───────────────────────────────────────────────────────────
function shareTodayResults(games, players, dateStr, setCopied) {
  const puzzleNum = getTodaysPuzzleNum(games, dateStr);
  const dayGames = puzzleNum
    ? games.filter(g => g.puzzleNum && parseInt(g.puzzleNum) === puzzleNum)
    : games.filter(g => g.date === dateStr);

  if (dayGames.length === 0) {
    alert("No results logged today yet!");
    return;
  }

  const entries = [];
  for (const game of dayGames) {
    for (const entry of game.players) { entries.push(entry); }
  }
  entries.sort((a,b) => {
    if (a.dnf && b.dnf) return (a.submittedAt||0)-(b.submittedAt||0);
    if (a.dnf) return 1;
    if (b.dnf) return -1;
    return (a.finalSeconds||0)-(b.finalSeconds||0);
  });

  const header = puzzleNum
    ? "MBA Friends Connections - Puzzle #" + puzzleNum
    : "MBA Friends Connections - " + dateStr;
  const medals = ["1st","2nd","3rd"];
  const colorEmoji = { yellow:"🟡", blue:"🔵", green:"🟢", purple:"🟣" };

  const lines = entries.map((e, i) => {
    const medal = medals[i] || (i + 1) + ".";
    const time = e.dnf ? "DNF" : e.finalTime;
    const grid = e.gridRows
      ? e.gridRows.map(row => row.map(c => colorEmoji[c] || "").join("")).join(" ")
      : "";
    return medal + " " + e.name + "  " + time + "\n" + grid;
  });

  const text = header + "\n\n" + lines.join("\n\n");

  navigator.clipboard.writeText(text).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }).catch(() => alert("Could not copy - try again"));
}

