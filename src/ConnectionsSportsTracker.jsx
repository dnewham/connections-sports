import { useState, useEffect, useCallback } from "react";

// ── Color definitions ──────────────────────────────────────────────────────
const COLOR = {
  yellow: { bg: "#F5C842", text: "#1a1a1a", emoji: ["🟡","🟨"], label: "Yellow" },
  blue:   { bg: "#5B9BD5", text: "#fff",    emoji: ["🔵","🟦"], label: "Blue"   },
  green:  { bg: "#6DBF6D", text: "#1a1a1a", emoji: ["🟢","🟩"], label: "Green"  },
  purple: { bg: "#A855C8", text: "#fff",    emoji: ["🟣","🟪"], label: "Purple" },
};

// ── Themes ─────────────────────────────────────────────────────────────────
const THEMES = {
  default_dark:  { label: "Default",        accent: "#F5C842", bg: "#0e0e12", surface: "#16161d", border: "#242430", text: "#e8e4f0", muted: "#6b6880" },
  oklahoma_dark: { label: "OU Dark",        accent: "#841617", bg: "#0e0e12", surface: "#16161d", border: "#242430", text: "#e8e4f0", muted: "#6b6880" },
  oklahoma_lite: { label: "OU Light",       accent: "#841617", bg: "#f5f5f5", surface: "#ffffff", border: "#ddd",    text: "#1a1a1a", muted: "#777"    },
  uga_dark:      { label: "UGA Dark",       accent: "#BA0C2F", bg: "#0e0e12", surface: "#16161d", border: "#242430", text: "#e8e4f0", muted: "#6b6880" },
  uga_lite:      { label: "UGA Light",      accent: "#BA0C2F", bg: "#f5f5f5", surface: "#ffffff", border: "#ddd",    text: "#1a1a1a", muted: "#777"    },
  gold_dark:     { label: "Gold Dark",      accent: "#F0A500", bg: "#0e0e12", surface: "#16161d", border: "#242430", text: "#e8e4f0", muted: "#6b6880" },
  gold_lite:     { label: "Gold Light",     accent: "#c98a00", bg: "#f5f5f5", surface: "#ffffff", border: "#ddd",    text: "#1a1a1a", muted: "#777"    },
  texas_dark:    { label: "Texas Dark",     accent: "#BF5700", bg: "#0e0e12", surface: "#16161d", border: "#242430", text: "#e8e4f0", muted: "#6b6880" },
  texas_lite:    { label: "Texas Light",    accent: "#BF5700", bg: "#f5f5f5", surface: "#ffffff", border: "#ddd",    text: "#1a1a1a", muted: "#777"    },
};

const DEFAULT_THEME = "default_dark";

// Theme stored in localStorage per browser so each player sees their own
function getSavedActivePlayer() {
  try { return localStorage.getItem("activePlayer") || null; } catch { return null; }
}
function saveActivePlayer(name) {
  try { if (name) localStorage.setItem("activePlayer", name); else localStorage.removeItem("activePlayer"); } catch {}
}
function getSavedTheme(name) {
  try { return localStorage.getItem(`theme_${name}`) || DEFAULT_THEME; } catch { return DEFAULT_THEME; }
}
function saveThemeLocally(name, themeId) {
  try { localStorage.setItem(`theme_${name}`, themeId); } catch {}
}

// ── Share-text parser ──────────────────────────────────────────────────────
function parseShareText(text) {
  const errors = [];
  const timeMatch = text.match(/(?:Time:\s*|in\s+)(\d{1,2}):(\d{2})/i);
  const puzzleMatch = text.match(/puzzle\s*#?(\d+)/i);
  const puzzleNum = puzzleMatch ? puzzleMatch[1] : null;
  const diffMatch = text.match(/ranked\s+([a-z\s]+?)(?:\.|Average|\n|$)/i);
  const difficulty = diffMatch ? diffMatch[1].trim() : null;
  // Detect explicit "4 mistakes" language — means DNF regardless of whether a time is present
  const fourMistakesMatch = /\b4 mistakes\b/i.test(text);

  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const gridRows = [];
  for (const line of lines) {
    const chars = [...line];
    const rowColors = [];
    let i = 0;
    while (i < chars.length) {
      const two = chars[i] + (chars[i+1] || "");
      const one = chars[i];
      let matched = false;
      for (const [id, def] of Object.entries(COLOR)) {
        if (def.emoji.includes(two)) { rowColors.push(id); i += 2; matched = true; break; }
        if (def.emoji.includes(one)) { rowColors.push(id); i += 1; matched = true; break; }
      }
      if (!matched) { if (rowColors.length > 0) rowColors.length = 0; break; }
    }
    if (rowColors.length >= 2) gridRows.push(rowColors);
  }
  if (gridRows.length === 0) errors.push("Could not find emoji grid in share text");

  // DNF if: no time found, OR 4+ mixed-color rows, OR explicit "4 mistakes" in text
  const mixedRows = gridRows.filter(r => !r.every(col => col === r[0])).length;
  const dnf = !timeMatch || mixedRows >= 4 || fourMistakesMatch;
  if (!timeMatch && mixedRows < 4 && !fourMistakesMatch) errors.push("Could not find Time (expected format MM:SS)");
  const rawSeconds = (!dnf && timeMatch) ? parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]) : null;
  const rawTime = (!dnf && timeMatch) ? `${timeMatch[1].padStart(2,"0")}:${timeMatch[2]}` : "DNF";
  // Warnings are non-fatal issues we want to flag to dster
  const warnings = [];
  if (!puzzleNum) warnings.push("Could not detect puzzle number — result stored by date only");
  if (!dnf && !timeMatch) warnings.push("Could not detect time");
  if (gridRows.length === 0) warnings.push("Could not detect emoji grid");
  return { rawTime, rawSeconds, puzzleNum, difficulty, gridRows, errors, warnings, dnf };
}

// ── Scoring engine ─────────────────────────────────────────────────────────
function calcScore({ rawSeconds, gridRows, dnf }) {
  if (dnf) return { adjustments: [], delta: 0, finalSeconds: null, finalTime: "DNF", dnf: true };
  const adjustments = [];
  let delta = 0;
  gridRows.forEach((row, idx) => {
    const allSame = row.every(c => c === row[0]);
    if (!allSame) {
      adjustments.push({ rule: "A", rowIdx: idx, label: "Incorrect guess", seconds: +5 });
      delta += 5;
    } else {
      const color = row[0];
      if (idx === 0 && color === "purple") { adjustments.push({ rule: "B", rowIdx: idx, label: "Purple Row 1", seconds: -15 }); delta -= 15; }
      if (idx === 0 && color === "blue")   { adjustments.push({ rule: "C", rowIdx: idx, label: "Blue Row 1 aka BBB", seconds: -5 }); delta -= 5; }
      if (idx === 1 && color === "purple") { adjustments.push({ rule: "D", rowIdx: idx, label: "Purple Row 2", seconds: -10 }); delta -= 10; }
    }
  });
  const finalSeconds = Math.max(0, rawSeconds + delta);
  const fmtT = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  return { adjustments, delta, finalSeconds, finalTime: fmtT(finalSeconds) };
}

// ── Storage (Firebase Firestore) ───────────────────────────────────────────
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

const DOC_REF = () => doc(db, "appdata", "main");

async function loadData() {
  try {
    const snap = await getDoc(DOC_REF());
    if (!snap.exists()) return { players: [], games: [] };
    const raw = snap.data().json;
    return raw ? JSON.parse(raw) : { players: [], games: [] };
  } catch(e) {
    console.error("loadData error", e);
    return { players: [], games: [] };
  }
}
async function saveData(d) {
  try { await setDoc(DOC_REF(), { json: JSON.stringify(d) }); }
  catch(e) { console.error("saveData error", e); }
}

// ── Date helpers ───────────────────────────────────────────────────────────
function getISOWeek(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7));
  const year = mon.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const weekNum = Math.ceil(((mon - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2,"0")}`;
}
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function thisWeekStr() { return getISOWeek(todayStr()); }
function weekDateRange(weekStr, games) {
  // Derive the date range from actual game dates in this week
  const dates = games
    .filter(g => g.date && getISOWeek(g.date) === weekStr)
    .map(g => g.date)
    .sort();
  if (dates.length === 0) return weekStr;
  const fmt = dateStr => {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const year = dates[0].slice(0, 4);
  return `${fmt(dates[0])} - ${fmt(dates[dates.length - 1])}, ${year}`;
}

function lastWeekStr() {
  // Find the Monday of the current week, then go back 1 day to land in last week
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((day + 6) % 7)); // rewind to this Monday
  monday.setDate(monday.getDate() - 1);           // step back into last week (Sunday)
  return getISOWeek(`${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,"0")}-${String(monday.getDate()).padStart(2,"0")}`);
}

// ── Leaderboard helpers ────────────────────────────────────────────────────
const fmt = s => s == null ? "—:—" : `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

// players array may contain strings (legacy) or {name} objects
function playerNames(players) { return players.map(p => typeof p === "string" ? p : p.name); }

function getPlayerStats(games, name) {
  const entries = games
    .filter(g => g.players.some(p => p.name === name))
    .map(g => g.players.find(p => p.name === name));
  const finalTimes = entries.map(e => e.finalSeconds).filter(n => n != null);
  const bestFinal = finalTimes.length ? Math.min(...finalTimes) : null;
  const avgFinal  = finalTimes.length ? Math.round(finalTimes.reduce((a,b)=>a+b,0)/finalTimes.length) : null;
  return { played: entries.length, bestFinal, avgFinal, fmtBest: fmt(bestFinal), fmtAvg: fmt(avgFinal) };
}

function getLeaderboard(games, players) {
  return playerNames(players).map(name => ({ name, ...getPlayerStats(games, name) }))
    .sort((a,b) => {
      if (a.bestFinal==null&&b.bestFinal==null) return 0;
      if (a.bestFinal==null) return 1;
      if (b.bestFinal==null) return -1;
      return a.bestFinal-b.bestFinal;
    });
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA + "T12:00:00");
  const b = new Date(dateB + "T12:00:00");
  return Math.round((b - a) / 86400000);
}

function getTodaysPuzzleNum(games, dateStr) {
  // First: check if any game today already has a puzzle number
  const todayGames = games.filter(g => g.date === dateStr && g.puzzleNum);
  if (todayGames.length > 0) {
    return Math.max(...todayGames.map(g => parseInt(g.puzzleNum)));
  }
  // Second: extrapolate from the most recent game that has both a date and puzzle number
  const anchors = games
    .filter(g => g.date && g.puzzleNum)
    .map(g => ({ date: g.date, puzzleNum: parseInt(g.puzzleNum) }))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (anchors.length > 0) {
    const anchor = anchors[0];
    const diff = daysBetween(anchor.date, dateStr);
    // Only extrapolate up to 7 days out to avoid bad data compounding
    if (diff >= 0 && diff <= 7) {
      return anchor.puzzleNum + diff;
    }
  }
  return null;
}

function getDailyLeaderboard(games, players, dateStr) {
  const puzzleNum = getTodaysPuzzleNum(games, dateStr);
  const dayGames = puzzleNum
    ? games.filter(g => (g.puzzleNum && parseInt(g.puzzleNum) === puzzleNum) || (!g.puzzleNum && g.date === dateStr))
    : games.filter(g => g.date === dateStr);
  const entries = [];
  for (const name of playerNames(players)) {
    for (const game of dayGames) {
      const p = game.players.find(e => e.name === name);
      if (p) entries.push({ name, finalSeconds: p.finalSeconds, submittedAt: p.submittedAt || 0, finalTime: p.finalTime, dnf: p.dnf || false });
    }
  }
  return entries.sort((a,b) => {
    if (a.finalSeconds == null && b.finalSeconds == null) return a.submittedAt - b.submittedAt;
    if (a.finalSeconds == null) return 1;
    if (b.finalSeconds == null) return -1;
    if (a.finalSeconds !== b.finalSeconds) return a.finalSeconds - b.finalSeconds;
    return a.submittedAt - b.submittedAt;
  });
}

function getWeeklyLeaderboard(games, players, weekStr) {
  const weekGames = games.filter(g => g.date && getISOWeek(g.date) === weekStr);
  const dates = [...new Set(weekGames.map(g => g.date))].sort();
  const names = playerNames(players);
  const stats = {};
  for (const name of names) stats[name] = { name, wins: 0, finishes: 0, cumSeconds: 0, played: 0 };
  for (const date of dates) {
    const ranked = getDailyLeaderboard(weekGames, names, date);
    if (ranked.length === 0) continue;
    const winner = ranked[0];
    if (stats[winner.name] && !winner.dnf) stats[winner.name].wins++;
    for (const entry of ranked) {
      if (stats[entry.name]) {
        stats[entry.name].played++;
        if (!entry.dnf) {
          stats[entry.name].finishes++;
          stats[entry.name].cumSeconds += entry.finalSeconds;
        }
      }
    }
  }
  return Object.values(stats).sort((a,b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;               // 1. most daily wins
    if (b.finishes !== a.finishes) return b.finishes - a.finishes; // 2. most daily finishes
    return a.cumSeconds - b.cumSeconds;                           // 3. lowest cumulative time
  });
}

function getAllTimeDailyWins(games, players) {
  const names = playerNames(players);
  const wins = {};
  for (const name of names) wins[name] = 0;
  const dates = [...new Set(games.map(g => g.date).filter(Boolean))].sort();
  for (const date of dates) {
    const ranked = getDailyLeaderboard(games, names, date);
    if (ranked.length > 0 && wins[ranked[0].name] != null) wins[ranked[0].name]++;
  }
  return names.map(name => ({ name, wins: wins[name] })).sort((a,b) => b.wins - a.wins);
}

function getAllTimeDNFs(games, players) {
  // Seed with known historical DNFs that predate rawInput tracking
  const historical = { "dster": 2, "Rynomite": 2, "Liudacris": 7, "Show-me Willy": 5 };
  const names = playerNames(players);
  const dnfs = {};
  for (const name of names) dnfs[name] = historical[name] || 0;
  // Add any DNFs recorded in Firestore (avoid double-counting historical ones
  // by only counting entries that have rawInput, meaning they were submitted after tracking began)
  for (const game of games) {
    for (const entry of game.players) {
      if (entry.dnf && entry.rawInput && dnfs[entry.name] != null) {
        dnfs[entry.name]++;
      }
    }
  }
  return names.map(name => ({ name, wins: dnfs[name] })).sort((a,b) => b.wins - a.wins);
}

function getAllTimeWeeklyWins(games, players) {
  const names = playerNames(players);
  const wins = {};
  for (const name of names) wins[name] = 0;
  const weeks = [...new Set(games.map(g => g.date ? getISOWeek(g.date) : null).filter(Boolean))];
  for (const week of weeks) {
    const ranked = getWeeklyLeaderboard(games, names, week);
    if (ranked.length > 0 && ranked[0].wins > 0 && wins[ranked[0].name] != null) wins[ranked[0].name]++;
  }
  return names.map(name => ({ name, wins: wins[name] })).sort((a,b) => b.wins - a.wins);
}

// ── Design tokens (dynamic via theme) ─────────────────────────────────────
const mono = "'DM Mono','Fira Mono',monospace";
const display = "'DM Mono','Fira Mono',monospace";

// ── Shared UI ──────────────────────────────────────────────────────────────
function Screen({ title, onBack, children, T }) {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:mono }}>
      <div style={{ maxWidth:480, margin:"0 auto", padding:"0 16px 80px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"18px 0 14px", borderBottom:`1px solid ${T.border}` }}>
          {onBack && <button onClick={onBack} style={{ background:"none", border:"none", color:T.muted, fontSize:20, cursor:"pointer", padding:"2px 10px 2px 0" }}>←</button>}
          <h1 style={{ margin:0, fontFamily:display, fontSize:"clamp(10px, 1.8vw, 15px)", fontWeight:800, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
function Card({ children, style, onClick, T }) {
  return <div onClick={onClick} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:16, cursor:onClick?"pointer":undefined, ...style }}>{children}</div>;
}
function Btn({ children, onClick, variant="primary", disabled, style, T }) {
  const base = { fontFamily:mono, fontWeight:700, fontSize:14, borderRadius:9, cursor:disabled?"not-allowed":"pointer", border:"none", padding:"12px 18px", letterSpacing:"0.05em", opacity:disabled?0.45:1, transition:"opacity .15s", ...style };
  const variants = { primary:{ background:T.accent, color: T.bg === "#f5f5f5" ? "#fff" : "#111" }, ghost:{ background:T.surface, color:T.text, border:`1px solid ${T.border}` } };
  return <button onClick={disabled?undefined:onClick} style={{ ...base, ...variants[variant] }}>{children}</button>;
}
function ColorDot({ color, size=14 }) {
  return <span style={{ display:"inline-block", width:size, height:size, borderRadius:"50%", background:COLOR[color]?.bg||"#555", flexShrink:0 }} />;
}
function GridPreview({ gridRows }) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      {gridRows.map((row,i) => <div key={i} style={{ display:"flex", gap:3 }}>{row.map((c,j) => <ColorDot key={j} color={c} size={11} />)}</div>)}
    </div>
  );
}
function ParsePreview({ parsed, score, T }) {
  const { rawTime, puzzleNum, difficulty, gridRows, dnf } = parsed;
  const { adjustments, finalTime } = score;
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
        <div>
          {puzzleNum && <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.08em", textTransform:"uppercase" }}>Puzzle #{puzzleNum}</div>}
          {difficulty && <div style={{ fontSize:12, color:T.muted, marginTop:2, textTransform:"capitalize" }}>{difficulty}</div>}
        </div>
        <GridPreview gridRows={gridRows} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", alignItems:"center", gap:8, marginBottom:14 }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:display, fontWeight:800, fontSize:22, color:T.muted }}>{rawTime}</div>
          <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:2 }}>Raw Time</div>
        </div>
        <div style={{ color:T.muted, fontSize:18 }}>→</div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontFamily:display, fontWeight:800, fontSize:22, color:T.accent }}>{finalTime}</div>
          <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:2 }}>Final Time</div>
        </div>
      </div>
      {adjustments.length > 0 ? (
        <div style={{ background:T.bg, borderRadius:8, padding:"10px 12px" }}>
          {adjustments.map((a,i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:a.seconds>0?"#e07070":"#6DBF6D", padding:"3px 0" }}>
              <span>Rule {a.rule}: {a.label}</span>
              <span style={{ fontFamily:display, fontWeight:700 }}>{a.seconds>0?`+${a.seconds}s`:`${a.seconds}s`}</span>
            </div>
          ))}
        </div>
      ) : (
        !dnf && <div style={{ fontSize:12, color:T.muted, textAlign:"center" }}>No adjustments — clean base time!</div>
      )}
    </div>
  );
}

function WinsBarChart({ data, label, T }) {
  const max = Math.max(...data.map(d => d.wins), 1);
  return (
    <div>
      <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>{label}</div>
      {data.map((d, i) => (
        <div key={d.name} style={{ marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
            <span style={{ fontWeight:700 }}>{["🥇","🥈","🥉"][i] || ""} {d.name}</span>
            <span style={{ color:T.accent, fontFamily:display, fontWeight:800 }}>{d.wins}</span>
          </div>
          <div style={{ background:T.border, borderRadius:4, height:8, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${(d.wins/max)*100}%`, background: i===0 ? T.accent : T.muted, borderRadius:4, transition:"width 0.4s ease" }} />
          </div>
        </div>
      ))}
      {data.every(d => d.wins === 0) && <div style={{ color:T.muted, fontSize:12, textAlign:"center", padding:"10px 0" }}>No wins yet</div>}
    </div>
  );
}

function Tabs({ tabs, active, onChange, T }) {
  return (
    <div style={{ display:"flex", gap:4, background:T.surface, borderRadius:10, padding:4, marginBottom:16 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          flex:1, padding:"8px 4px", border:"none", borderRadius:7, cursor:"pointer", fontFamily:mono,
          fontSize:11, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase",
          background: active===t.id ? T.accent : "transparent",
          color: active===t.id ? (T.bg === "#f5f5f5" ? "#fff" : "#111") : T.muted,
          transition:"all .15s"
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// ── Theme Picker ───────────────────────────────────────────────────────────
function ThemePicker({ value, onChange, T }) {
  const groups = [
    { label: "Default",  ids: ["default_dark"] },
    { label: "Oklahoma", ids: ["oklahoma_dark","oklahoma_lite"] },
    { label: "UGA",      ids: ["uga_dark","uga_lite"] },
    { label: "Gold",     ids: ["gold_dark","gold_lite"] },
    { label: "Texas",    ids: ["texas_dark","texas_lite"] },
  ];
  return (
    <div>
      <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:8 }}>Color Theme</div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
        {groups.map(g => g.ids.map(id => {
          const th = THEMES[id];
          const isSelected = value === id;
          return (
            <button key={id} onClick={() => onChange(id)} style={{
              display:"flex", flexDirection:"column", alignItems:"center", gap:4,
              padding:"8px 10px", borderRadius:8, cursor:"pointer", fontFamily:mono,
              fontSize:10, fontWeight:700, letterSpacing:"0.04em",
              border: isSelected ? `2px solid ${T.accent}` : `1px solid ${T.border}`,
              background: isSelected ? `${T.accent}22` : T.surface,
              color: T.text, minWidth:64,
            }}>
              <div style={{ display:"flex", gap:3 }}>
                <span style={{ width:14, height:14, borderRadius:"50%", background:th.accent, display:"inline-block" }} />
                <span style={{ width:14, height:14, borderRadius:"50%", background:th.bg === "#f5f5f5" ? "#fff" : "#111", border:"1px solid #aaa", display:"inline-block" }} />
              </div>
              <span>{th.label}</span>
            </button>
          );
        }))}
      </div>
    </div>
  );
}

// ── Share helper ───────────────────────────────────────────────────────────
function shareTodayResults(games, players, dateStr, setCopied) {
  const puzzleNum = getTodaysPuzzleNum(games, dateStr);
  const dayGames = puzzleNum
    ? games.filter(g => (g.puzzleNum && parseInt(g.puzzleNum) === puzzleNum) || (!g.puzzleNum && g.date === dateStr))
    : games.filter(g => g.date === dateStr);
  if (dayGames.length === 0) { alert("No results logged today yet!"); return; }
  const entries = [];
  for (const game of dayGames) { for (const entry of game.players) { entries.push(entry); } }
  entries.sort((a,b) => {
    if (a.dnf && b.dnf) return (a.submittedAt||0)-(b.submittedAt||0);
    if (a.dnf) return 1; if (b.dnf) return -1;
    return (a.finalSeconds||0)-(b.finalSeconds||0);
  });
  const header = puzzleNum
    ? "MBA Friends Connections — Puzzle #" + puzzleNum
    : "MBA Friends Connections — " + dateStr;
  const medals = ["🥇","🥈","🥉"];
  const colorEmoji = { yellow:"🟡", blue:"🔵", green:"🟢", purple:"🟣" };
  const lines = entries.map((e, i) => {
    const medal = medals[i] || (i + 1) + ".";
    const time = e.dnf ? "DNF" : e.finalTime;
    // Grid: each row on its own line
    const grid = e.gridRows ? e.gridRows.map(row => row.map(c => colorEmoji[c] || "").join("")).join("\n") : "";
    // Original time and adjustments — omit for DNF
    const origTime = !e.dnf && e.rawTime ? "Original Time " + e.rawTime : "";
    let adjBlock = "";
    if (!e.dnf && e.adjustments && e.adjustments.length > 0) {
      const adjLines = e.adjustments.map(a => a.label + " (" + (a.seconds > 0 ? "+" : "") + a.seconds + "s)");
      adjBlock = "Adjustments:\n" + adjLines.join("\n");
    }
    const parts = [medal + " " + e.name + "  " + time];
    if (grid) parts.push(grid);
    if (origTime) parts.push(origTime);
    if (adjBlock) parts.push(adjBlock);
    return parts.join("\n");
  });
  const text = header + "\n\n" + lines.join("\n\n");
  navigator.clipboard.writeText(text).then(() => {
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  }).catch(() => alert("Could not copy — try again"));
}

// ── Weekly Recap Generator ────────────────────────────────────────────────
async function generateRecap(games, players, weekStr) {
  // Collect all games from the target week
  const weekGames = games.filter(g => g.date && getISOWeek(g.date) === weekStr);
  if (weekGames.length === 0) return null;

  const names = playerNames(players);
  const dates = [...new Set(weekGames.map(g => g.date))].sort();

  // Build a structured summary of the week
  const dailySummaries = dates.map(date => {
    const puzzleNum = getTodaysPuzzleNum(weekGames, date);
    const label = puzzleNum ? `Puzzle #${puzzleNum}` : date;
    // Get only the games for this specific day/puzzle
    const dayGames = puzzleNum
      ? weekGames.filter(g => g.puzzleNum && parseInt(g.puzzleNum) === puzzleNum)
      : weekGames.filter(g => g.date === date);
    const ranked = getDailyLeaderboard(dayGames, names, date);
    const results = ranked.map((p, i) => {
      const entry = dayGames.flatMap(g => g.players).find(e => e.name === p.name);
      const adjs = entry?.adjustments?.length
        ? entry.adjustments.map(a => `${a.label} (${a.seconds > 0 ? "+" : ""}${a.seconds}s)`).join(", ")
        : "none";
      return `  ${i+1}. ${p.name}: ${p.finalTime}${entry?.dnf ? " (DNF)" : ` (raw ${entry?.rawTime}, adjustments: ${adjs})`}`;
    });
    if (results.length === 0) return null;
    return `${label}:\n${results.join("\n")}`;
  }).filter(Boolean);

  // Weekly standings
  const weekly = getWeeklyLeaderboard(weekGames, names, weekStr);
  const standings = weekly.filter(p => p.played > 0).map((p, i) =>
    `  ${i+1}. ${p.name}: ${p.wins} daily win${p.wins !== 1 ? "s" : ""}, ${p.finishes} finish${p.finishes !== 1 ? "es" : ""}, ${p.played} days played, ${fmt(p.cumSeconds)} cumulative time`
  );

  const dateRange = weekDateRange(weekStr, games);
  const prompt = `You are the announcer for a competitive friend group's weekly Connections: Sports Edition puzzle recap. The group plays NYT Connections Sports Edition daily and tracks their scores with custom rules.

SCORING RULES (for context):
- Base score = time to complete the puzzle
- Each wrong guess = +5 seconds penalty
- Solving purple first = -15 seconds bonus
- Solving blue first = -5 seconds bonus  
- Solving purple second = -10 seconds bonus
- DNF = did not finish (used all 4 wrong guesses)
- Lowest adjusted time wins each day
- Weekly ranking: 1st most daily wins, 2nd most daily finishes (DNF days excluded), 3rd lowest cumulative adjusted time

PLAYERS: ${names.join(", ")}

WEEK: ${weekStr} (${dateRange})

DAILY RESULTS:
${dailySummaries.join("\n\n")}

WEEKLY STANDINGS:
${standings.join("\n")}

Write a weekly recap in the style of a mix between ESPN SportsCenter, competitive trash talk, and friendly banter. It should:
- Open with a punchy headline for the week — the headline must include the week date range in parentheses immediately after the week number, e.g. "WEEK 12 RECAP (Mar 16 - Mar 22, 2026): YOUR PUNCHY TITLE HERE"
- Recap each day's action with color commentary, calling out impressive times, brutal DNFs, close finishes, and any notable adjustments
- Crown the weekly winner with appropriate fanfare
- Call out the week's best single performance
- End with some lighthearted trash talk or predictions for next week
- Keep it fun, specific to the actual results, and around 250-350 words
- Use the players' full names throughout`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
  let response;
  try {
    response = await fetch("/api/recap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API error ${response.status}`);
  }
  const data = await response.json();
  return data.text || "Could not generate recap.";
}

// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [data, setData]             = useState(null);
  const [screen, setScreen]         = useState("home");
  const [detail, setDetail]         = useState(null);
  const [saving, setSaving]         = useState(false);
  const [logStep, setLogStep]       = useState("pick");
  const [logPlayer, setLogPlayer]   = useState(null);
  const [pasteText, setPasteText]   = useState("");
  const [parsed, setParsed]         = useState(null);
  const [score, setScore]           = useState(null);
  const [parseError, setParseError] = useState([]);
  const [newName, setNewName]       = useState("");
  const [newTheme, setNewTheme]     = useState("default_dark");
  const [lbTab, setLbTab]           = useState("daily");
  const [editThemePlayer, setEditThemePlayer] = useState(null);
  const [copied, setCopied]         = useState(false);
  const [copiedInput, setCopiedInput] = useState(null); // stores "name-gameId" of the entry whose input was just copied
  const [renamingPlayer, setRenamingPlayer] = useState(null); // name currently being renamed
  const [renameValue, setRenameValue]   = useState("");
  const [recap, setRecap]             = useState(null);  // generated recap text
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapWeek, setRecapWeek]     = useState(null);  // which week the recap is for
  const [copiedRecap, setCopiedRecap] = useState(false);
  const [activePlayer, setActivePlayer] = useState(getSavedActivePlayer);

  useEffect(() => { loadData().then(setData); }, []);

  const activeThemeId = activePlayer ? getSavedTheme(activePlayer) : DEFAULT_THEME;
  const T = THEMES[activeThemeId] || THEMES[DEFAULT_THEME];

  const switchPlayer = (name) => { setActivePlayer(name); saveActivePlayer(name); };

  const persist = useCallback(async next => { setSaving(true); setData(next); await saveData(next); setSaving(false); }, []);

  const addPlayer = () => {
    const name = newName.trim();
    if (!name || !data || playerNames(data.players).includes(name)) return;
    saveThemeLocally(name, newTheme);
    persist({ ...data, players: [...data.players, name] });
    setNewName(""); setNewTheme("default_dark");
  };
  const removePlayer = name => {
    if (!window.confirm(`Remove ${name}? Their game history will be kept.`)) return;
    persist({ ...data, players: data.players.filter(p => (typeof p==="string"?p:p.name) !== name) });
  };
  const renamePlayer = async (oldName, newName) => {
    newName = newName.trim();
    if (!newName || newName === oldName) { setRenamingPlayer(null); return; }
    if (playerNames(data.players).includes(newName)) {
      alert(`"${newName}" is already taken — choose a different name.`); return;
    }
    setSaving(true);
    const fresh = await loadData();
    // Update players array
    const players = fresh.players.map(p => {
      const n = typeof p === "string" ? p : p.name;
      return n === oldName ? newName : p;
    });
    // Update every game entry that references the old name
    const games = fresh.games.map(game => ({
      ...game,
      players: game.players.map(e => e.name === oldName ? { ...e, name: newName } : e),
    }));
    // Migrate localStorage theme
    const theme = getSavedTheme(oldName);
    saveThemeLocally(newName, theme);
    // If this was the active player, update that too
    if (activePlayer === oldName) { setActivePlayer(newName); saveActivePlayer(newName); }
    const next = { ...fresh, players, games };
    await saveData(next);
    setData(next);
    setSaving(false);
    setRenamingPlayer(null);
    setRenameValue("");
  };
  const handleParse = () => {
    const p = parseShareText(pasteText);
    if (p.errors.length && !p.dnf) { setParseError(p.errors); setParsed(null); setScore(null); return; }
    if (p.dnf && p.gridRows.length === 0) { setParseError(p.errors); setParsed(null); setScore(null); return; }
    const s = calcScore(p);
    setParsed(p); setScore(s); setParseError([]); setLogStep("review");
  };
  const submitEntry = async () => {
    const entry = {
      name: logPlayer,
      rawTime: parsed.rawTime,
      rawSeconds: parsed.rawSeconds,
      finalSeconds: score.finalSeconds,
      finalTime: score.finalTime,
      adjustments: score.adjustments,
      gridRows: parsed.gridRows,
      mistakes: parsed.gridRows.filter(r => !r.every(c => c === r[0])).length,
      puzzleNum: parsed.puzzleNum,
      difficulty: parsed.difficulty,
      submittedAt: Date.now(),
      dnf: score.dnf || false,
      rawInput: pasteText,
      parseWarnings: parsed.warnings || [],
    };
    const today = todayStr();
    setSaving(true);
    // Always fetch fresh data from Firestore before writing to avoid overwriting other players' results
    const fresh = await loadData();
    // If the share text had no puzzle number, try to infer it from fresh data
    const inferredPuzzleNum = parsed.puzzleNum || String(getTodaysPuzzleNum(fresh.games, today) || "");
    const gameId = inferredPuzzleNum ? `puzzle-${inferredPuzzleNum}` : `date-${today}`;
    // Backfill puzzleNum on the entry if we inferred it, and clear the related warning
    if (!parsed.puzzleNum && inferredPuzzleNum) {
      entry.puzzleNum = inferredPuzzleNum;
      entry.parseWarnings = entry.parseWarnings.filter(w => !w.includes("puzzle number"));
    }
    const games = [...fresh.games];
    const existingIdx = games.findIndex(g => g.id === gameId);
    if (existingIdx >= 0) {
      games[existingIdx] = { ...games[existingIdx], players: [...games[existingIdx].players.filter(p=>p.name!==logPlayer), entry] };
    } else {
      games.unshift({ id:gameId, date:today, puzzleNum:parsed.puzzleNum, difficulty:parsed.difficulty, players:[entry] });
    }
    const next = { ...fresh, players: fresh.players.length ? fresh.players : data.players };
    next.games = games;
    await saveData(next);
    setData(next);
    setSaving(false);
    setLogStep("pick"); setLogPlayer(null); setPasteText(""); setParsed(null); setScore(null);
    setScreen("home");
  };

  if (!data) return <div style={{ minHeight:"100vh", background:"#0e0e12", display:"flex", alignItems:"center", justifyContent:"center", color:"#6b6880", fontFamily:mono }}>Loading…</div>;

  const names = playerNames(data.players);

  // ── WHO ARE YOU? ────────────────────────────────────────────────────────
  if (!activePlayer || !names.includes(activePlayer)) {
    const DT = THEMES[DEFAULT_THEME];
    return (
      <div style={{ minHeight:"100vh", background:DT.bg, color:DT.text, fontFamily:mono, display:"flex", alignItems:"center", justifyContent:"center" }}>
        <div style={{ maxWidth:360, width:"100%", padding:"0 24px" }}>
          <div style={{ textAlign:"center", marginBottom:32 }}>
            <div style={{ fontSize:36, marginBottom:12 }}>🏆</div>
            <h1 style={{ margin:0, fontFamily:display, fontSize:18, fontWeight:800, letterSpacing:"0.06em", textTransform:"uppercase" }}>MBA Friends Connections</h1>
            <div style={{ fontSize:13, color:DT.muted, marginTop:8 }}>Who's playing on this device?</div>
          </div>
          {names.length === 0 && (
            <div style={{ textAlign:"center", color:DT.muted, fontSize:13 }}>No players added yet.</div>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {names.map(name => {
              const th = THEMES[getSavedTheme(name)];
              return (
                <button key={name} onClick={() => switchPlayer(name)} style={{
                  display:"flex", alignItems:"center", gap:12, padding:"14px 16px",
                  background:DT.surface, border:`1px solid ${DT.border}`, borderRadius:12,
                  cursor:"pointer", fontFamily:mono, color:DT.text, textAlign:"left",
                }}>
                  <span style={{ width:14, height:14, borderRadius:"50%", background:th.accent, display:"inline-block", flexShrink:0 }} />
                  <span style={{ fontWeight:700, fontSize:16, flex:1 }}>{name}</span>
                  <span style={{ fontSize:12, color:DT.muted }}>{th.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── LOG: pick player ────────────────────────────────────────────────────
  // ── LOG: paste share text ───────────────────────────────────────────────
  if (screen==="log" && logStep==="paste") return (
    <Screen title={`Paste Result — ${logPlayer}`} onBack={() => setLogStep("pick")} T={T}>
      <div style={{ marginTop:20 }}>
        <div style={{ fontSize:12, color:T.muted, marginBottom:8 }}>Paste your share text from The Athletic Connections app:</div>
        <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setParseError([]); }}
          placeholder={"Connections: Sports Edition\nTime: 00:51\nMy stats are in! I solved puzzle #530…\n🟡🟡🔵🟣\n🔵🔵🔵🔵\n…"}
          style={{ width:"100%", minHeight:180, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, color:T.text, fontFamily:mono, fontSize:13, padding:12, resize:"vertical", boxSizing:"border-box", outline:"none", lineHeight:1.6 }} />
        {parseError.length>0 && (
          <div style={{ background:"#1e1010", border:`1px solid #3a1a1a`, borderRadius:8, padding:"10px 12px", marginTop:10 }}>
            {parseError.map((e,i) => <div key={i} style={{ fontSize:12, color:"#e07070" }}>⚠ {e}</div>)}
          </div>
        )}
        <Btn T={T} onClick={handleParse} disabled={!pasteText.trim()} style={{ width:"100%", marginTop:14 }}>Parse Results →</Btn>
      </div>
    </Screen>
  );

  // ── LOG: review ─────────────────────────────────────────────────────────
  if (screen==="log" && logStep==="review" && parsed && score) return (
    <Screen title={`Review — ${logPlayer}`} onBack={() => setLogStep("paste")} T={T}>
      <div style={{ marginTop:20 }}>
        <Card T={T} style={{ marginBottom:14 }}><ParsePreview parsed={parsed} score={score} T={T} /></Card>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <Btn T={T} variant="ghost" onClick={() => setLogStep("paste")}>← Re-paste</Btn>
          <Btn T={T} onClick={submitEntry} disabled={saving}>{saving?"Saving…":"Save ✓"}</Btn>
        </div>
      </div>
    </Screen>
  );

  // ── LEADERBOARD ─────────────────────────────────────────────────────────
  if (screen==="leaderboard") {
    const today = todayStr();
    const thisWeek = thisWeekStr();
    const dailyRanked  = getDailyLeaderboard(data.games, names, today);
    const weeklyRanked = getWeeklyLeaderboard(data.games, names, thisWeek);
    const allTimeLb    = getLeaderboard(data.games, names);
    return (
      <Screen title="Leaderboard" onBack={() => setScreen("home")} T={T}>
        <div style={{ marginTop:16 }}>
          <Tabs T={T}
            tabs={[{ id:"daily", label:"Today" }, { id:"weekly", label:"This Week" }, { id:"alltime", label:"All Time" }]}
            active={lbTab} onChange={setLbTab}
          />
          {lbTab==="daily" && (
            <div>
              {(() => {
                const pNum = getTodaysPuzzleNum(data.games, today);
                return <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginBottom:14 }}>{pNum ? `Puzzle #${pNum}` : today} · lowest adjusted time wins</div>;
              })()}
              {dailyRanked.length===0 && <div style={{ color:T.muted, textAlign:"center", padding:40, fontSize:13 }}>No results logged today yet.</div>}
              {dailyRanked.map((p,idx) => (
                <Card key={p.name} T={T} style={{ marginBottom:10, borderColor:idx===0?`${T.accent}40`:T.border }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ fontSize:20, minWidth:28 }}>{["🥇","🥈","🥉"][idx]||`${idx+1}.`}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ width:10, height:10, borderRadius:"50%", background:THEMES[getSavedTheme(p.name)].accent, display:"inline-block", flexShrink:0 }} />
                        <span style={{ fontWeight:700, fontSize:15 }}>{p.name}</span>
                      </div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:display, fontWeight:800, fontSize:20, color:T.accent }}>{p.finalTime}</div>
                      <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.06em", textTransform:"uppercase" }}>Final Time</div>
                    </div>
                  </div>
                </Card>
              ))}
              {dailyRanked.length>0 && <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginTop:8 }}>Tiebreak: first to submit</div>}
            </div>
          )}
          {lbTab==="weekly" && (
            <div>
              <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginBottom:14 }}>Week of {thisWeek} · Mon–Sun</div>
              {weeklyRanked.every(p=>p.played===0) && <div style={{ color:T.muted, textAlign:"center", padding:40, fontSize:13 }}>No results logged this week yet.</div>}
              {weeklyRanked.filter(p=>p.played>0).map((p,idx) => (
                <Card key={p.name} T={T} style={{ marginBottom:10, borderColor:idx===0?`${T.accent}40`:T.border }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ fontSize:20, minWidth:28 }}>{["🥇","🥈","🥉"][idx]||`${idx+1}.`}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        <span style={{ width:10, height:10, borderRadius:"50%", background:THEMES[getSavedTheme(p.name)].accent, display:"inline-block", flexShrink:0 }} />
                        <span style={{ fontWeight:700, fontSize:15 }}>{p.name}</span>
                      </div>
                      <div style={{ fontSize:11, color:T.muted, marginTop:3 }}>{p.played} day{p.played!==1?"s":""} played · {p.finishes} finish{p.finishes!==1?"es":""} · {fmt(p.cumSeconds)} cumulative</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:display, fontWeight:800, fontSize:24, color:T.accent }}>{p.wins}</div>
                      <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.06em", textTransform:"uppercase" }}>Daily Wins</div>
                    </div>
                  </div>
                </Card>
              ))}
              {weeklyRanked.some(p=>p.played>0) && (
              <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginTop:8 }}>
                Ranked by: most wins · most finishes · lowest cumulative time
              </div>
            )}
            </div>
          )}
          {lbTab==="alltime" && (
            <div>
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>Best Time</div>
                {allTimeLb.map((p,idx) => (
                  <Card key={p.name} T={T} onClick={() => { setDetail(p.name); setScreen("playerDetail"); }} style={{ marginBottom:8, borderColor:idx===0?`${T.accent}40`:T.border }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ fontSize:18, minWidth:28 }}>{["🥇","🥈","🥉"][idx]||`${idx+1}.`}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span style={{ width:10, height:10, borderRadius:"50%", background:THEMES[getSavedTheme(p.name)].accent, display:"inline-block", flexShrink:0 }} />
                          <span style={{ fontWeight:700, fontSize:14 }}>{p.name}</span>
                        </div>
                        <div style={{ fontSize:11, color:T.muted, marginTop:2 }}>{p.played} game{p.played!==1?"s":""} · avg {p.fmtAvg}</div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ fontFamily:display, fontWeight:800, fontSize:18, color:T.accent }}>{p.fmtBest}</div>
                        <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.06em", textTransform:"uppercase" }}>Best</div>
                      </div>
                    </div>
                  </Card>
                ))}
                {allTimeLb.length>0 && <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginTop:4 }}>Tap for player details</div>}
              </div>
              <Card T={T} style={{ marginBottom:12 }}>
                <WinsBarChart data={getAllTimeDailyWins(data.games, names)} label="All-Time Daily Wins" T={T} />
              </Card>
              <Card T={T} style={{ marginBottom:12 }}>
                <WinsBarChart data={getAllTimeWeeklyWins(data.games, names)} label="All-Time Weekly Wins" T={T} />
              </Card>
              <Card T={T}>
                <WinsBarChart data={getAllTimeDNFs(data.games, names)} label="Dementia 'n Focus (All-Time DNFs)" T={T} />
              </Card>
            </div>
          )}
        </div>
      </Screen>
    );
  }

  // ── PLAYER DETAIL ───────────────────────────────────────────────────────
  if (screen==="playerDetail" && detail) {
    const stats = getPlayerStats(data.games, detail);
    const playerGames = data.games.filter(g => g.players.some(p => p.name===detail));
    const dailyWins = getAllTimeDailyWins(data.games, names).find(p=>p.name===detail)?.wins || 0;
    const weeklyWins = getAllTimeWeeklyWins(data.games, names).find(p=>p.name===detail)?.wins || 0;
    const DT = THEMES[DEFAULT_THEME];
    return (
      <Screen title={detail} onBack={() => setScreen("leaderboard")} T={DT}>
        <div style={{ marginTop:16 }}>
          <Card T={DT} style={{ marginBottom:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, textAlign:"center" }}>
              {[["Games",stats.played],["Best",stats.fmtBest],["Daily W",dailyWins],["Weekly W",weeklyWins]].map(([l,v])=>(
                <div key={l}>
                  <div style={{ fontFamily:display, fontWeight:800, fontSize:18, color:DT.accent }}>{v}</div>
                  <div style={{ fontSize:9, color:DT.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:3 }}>{l}</div>
                </div>
              ))}
            </div>
          </Card>
          <div style={{ fontSize:11, color:DT.muted, letterSpacing:"0.07em", textTransform:"uppercase", margin:"16px 0 8px" }}>Game History</div>
          {playerGames.map(game => {
            const entry = game.players.find(p => p.name===detail);
            return (
              <Card key={game.id} T={DT} style={{ marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontSize:12, color:DT.muted }}>{game.puzzleNum?`Puzzle #${game.puzzleNum}${game.date ? " · " + game.date : ""}`:game.date}{game.difficulty&&` · ${game.difficulty}`}</div>
                    <div style={{ display:"flex", gap:3, marginTop:6 }}>
                      {entry.gridRows?.map((row,i)=>(
                        <div key={i} style={{ display:"flex", gap:2 }}>{row.map((c,j)=><ColorDot key={j} color={c} size={10}/>)}</div>
                      ))}
                    </div>
                    {entry.adjustments?.length>0 && (
                      <div style={{ marginTop:6, fontSize:11 }}>
                        {entry.adjustments.map((a,i)=>(
                          <span key={i} style={{ marginRight:8, color:a.seconds>0?"#e07070":"#6DBF6D" }}>{a.label} ({a.seconds>0?`+${a.seconds}s`:`${a.seconds}s`})</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign:"right", marginLeft:12 }}>
                    <div style={{ fontFamily:display, fontWeight:800, fontSize:18, color:DT.accent }}>{entry.finalTime}</div>
                    <div style={{ fontSize:10, color:DT.muted, marginTop:2 }}>raw {entry.rawTime}</div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </Screen>
    );
  }

  // ── HISTORY ─────────────────────────────────────────────────────────────
  if (screen==="history") {
    const HT = THEMES[DEFAULT_THEME];
    return (
      <Screen title="Game History" onBack={() => setScreen("home")} T={T}>
        <div style={{ marginTop:16 }}>
          {data.games.length===0 && <div style={{ color:T.muted, textAlign:"center", padding:40, fontSize:13 }}>No games logged yet.</div>}
          {data.games.map(game=>(
            <Card key={game.id} T={T} style={{ marginBottom:12 }}>
              <div style={{ fontSize:12, color:T.muted, marginBottom:10, display:"flex", justifyContent:"space-between" }}>
                <span>{game.puzzleNum?`Puzzle #${game.puzzleNum}${game.date ? " · " + game.date : ""}`:game.date}</span>
                {game.difficulty&&<span style={{ textTransform:"capitalize" }}>{game.difficulty}</span>}
              </div>
              {[...game.players].sort((a,b) => {
                if (a.dnf && b.dnf) return 0;
                if (a.dnf) return 1; if (b.dnf) return -1;
                return (a.finalSeconds||0)-(b.finalSeconds||0);
              }).map(entry=>(
                <div key={entry.name} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderTop:`1px solid ${T.border}` }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ width:10, height:10, borderRadius:"50%", background:THEMES[getSavedTheme(entry.name)].accent, display:"inline-block", flexShrink:0 }} />
                      <span style={{ fontWeight:700, fontSize:14 }}>{entry.name}</span>
                      {entry.rawInput && (() => {
                        const key = entry.name + "-" + game.id;
                        const isCopied = copiedInput === key;
                        return (
                          <button onClick={() => {
                            navigator.clipboard.writeText(entry.rawInput).then(() => {
                              setCopiedInput(key);
                              setTimeout(() => setCopiedInput(null), 2500);
                            });
                          }} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:5, color:isCopied ? "#6DBF6D" : T.muted, fontSize:10, cursor:"pointer", fontFamily:mono, padding:"2px 6px", letterSpacing:"0.04em" }}>
                            {isCopied ? "✓ copied" : "copy input"}
                          </button>
                        );
                      })()}
                    </div>
                    <div style={{ display:"flex", gap:3, marginTop:4 }}>
                      {entry.gridRows?.map((row,i)=>(
                        <div key={i} style={{ display:"flex", gap:2 }}>{row.map((c,j)=><ColorDot key={j} color={c} size={9}/>)}</div>
                      ))}
                    </div>
                  </div>
                  <div style={{ textAlign:"right", marginLeft:12 }}>
                    <div style={{ fontFamily:display, fontWeight:800, fontSize:16, color:T.accent }}>{entry.finalTime}</div>
                    <div style={{ fontSize:10, color:T.muted }}>raw {entry.rawTime}</div>
                  </div>
                </div>
              ))}
            </Card>
          ))}
        </div>
      </Screen>
    );
  }

  // ── HOME ─────────────────────────────────────────────────────────────────
  const lb = getLeaderboard(data.games, names);
  const todayWinner = getDailyLeaderboard(data.games, names, todayStr())[0];
  const weekWinner  = getWeeklyLeaderboard(data.games, names, thisWeekStr()).find(p=>p.wins>0);
  return (
    <Screen title="🏆 MBA Friends Connections" T={T}>
      <div style={{ marginTop:20 }}>
        {data.games.length>0 && (
          <Card T={T} style={{ marginBottom:20 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, textAlign:"center" }}>
              <div>
                <div style={{ fontFamily:display, fontWeight:800, fontSize:26, color:T.accent }}>{data.games.length}</div>
                <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:3 }}>Games</div>
              </div>
              <div>
                <div style={{ fontFamily:display, fontWeight:800, fontSize:14, color:T.accent, lineHeight:1.2, marginTop:4 }}>{todayWinner?.name?.split(" ")[0]||"—"}</div>
                <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:5 }}>Today</div>
              </div>
              <div>
                <div style={{ fontFamily:display, fontWeight:800, fontSize:14, color:T.accent, lineHeight:1.2, marginTop:4 }}>{weekWinner?.name?.split(" ")[0]||"—"}</div>
                <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:5 }}>This Week</div>
              </div>
            </div>
          </Card>
        )}
        {(() => {
          if (activePlayer !== "dster") return null;
          const today = todayStr();
          const puzzleNum = getTodaysPuzzleNum(data.games, today);
          const todayGames = puzzleNum
            ? data.games.filter(g => g.puzzleNum && parseInt(g.puzzleNum) === puzzleNum)
            : data.games.filter(g => g.date === today);
          const warnings = [];
          for (const game of todayGames) {
            for (const entry of game.players) {
              if (entry.parseWarnings && entry.parseWarnings.length > 0) {
                entry.parseWarnings.forEach(w => warnings.push(`${entry.name}: ${w}`));
              }
            }
          }
          if (warnings.length === 0) return null;
          return (
            <div style={{ background:"#2a1a00", border:"1px solid #7a4400", borderRadius:10, padding:"10px 14px", marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#f0a500", marginBottom:6 }}>⚠ Parse Warnings</div>
              {warnings.map((w, i) => <div key={i} style={{ fontSize:11, color:"#f0c060" }}>{w}</div>)}
            </div>
          );
        })()}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
          <Btn T={T} onClick={() => { setLogPlayer(activePlayer); setLogStep("paste"); setScreen("log"); }} style={{ gridColumn:"1/-1", padding:16, fontSize:16 }}>📋 Log a Result</Btn>
          <Btn T={T} variant="ghost" onClick={() => { setLbTab("daily"); setScreen("leaderboard"); }} style={{ padding:14 }}>🏆 Leaderboard</Btn>
          <Btn T={T} variant="ghost" onClick={() => setScreen("history")} style={{ padding:14 }}>📅 History</Btn>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, padding:"10px 14px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:10, height:10, borderRadius:"50%", background:T.accent, display:"inline-block" }} />
            <span style={{ fontSize:13, fontWeight:700 }}>Playing as {activePlayer}</span>
          </div>
          <button onClick={() => { setActivePlayer(null); saveActivePlayer(null); }} style={{ background:"none", border:"none", color:T.muted, fontSize:12, cursor:"pointer", fontFamily:mono, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase" }}>Switch ↗</button>
        </div>
        <Btn T={T} variant="ghost" onClick={() => shareTodayResults(data.games, names, todayStr(), setCopied)} style={{ width:"100%", marginBottom:10, padding:12, boxSizing:"border-box" }}>{copied ? "✓ Copied!" : "📤 Share Today's Results"}</Btn>
        {(() => {
          // Show recap button for last week if there's data
          const lastWeek = lastWeekStr();
          const hasLastWeekData = data.games.some(g => g.date && getISOWeek(g.date) === lastWeek);
          if (!hasLastWeekData) return null;
          return (
            <div style={{ marginBottom:14 }}>
              <Btn T={T} variant="ghost" onClick={async () => {
                if (recapLoading) return;
                setRecapWeek(lastWeek);
                setRecapLoading(true);
                setRecap(null);
                try {
                  const text = await generateRecap(data.games, data.players, lastWeek);
                  setRecap(text);
                } catch(e) {
                  setRecap("⚠ Could not generate recap: " + (e.message || "unknown error"));
                } finally {
                  setRecapLoading(false);
                }
              }} style={{ width:"100%", padding:12, boxSizing:"border-box" }}>
                {recapLoading ? "✍️ Generating recap…" : recap && recapWeek === lastWeek ? "🔄 Regenerate Recap" : "📰 Last Week's Recap"}
              </Btn>
              {recap && recapWeek === lastWeek && (
                <Card T={T} style={{ marginTop:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase" }}>Week of {recapWeek}</div>
                    <button onClick={() => {
                      navigator.clipboard.writeText(recap).then(() => {
                        setCopiedRecap(true); setTimeout(() => setCopiedRecap(false), 2500);
                      });
                    }} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:5, color:copiedRecap ? "#6DBF6D" : T.muted, fontSize:10, cursor:"pointer", fontFamily:mono, padding:"3px 8px" }}>
                      {copiedRecap ? "✓ copied" : "copy"}
                    </button>
                  </div>
                  <div style={{ fontSize:13, color:T.text, lineHeight:1.7, whiteSpace:"pre-wrap" }}>{recap}</div>
                </Card>
              )}
            </div>
          );
        })()}
        {names.length===0 && <div style={{ textAlign:"center", color:T.muted, fontSize:13, marginBottom:20 }}>Add your players below to get started.</div>}
        <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>Players</div>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPlayer()} placeholder="Add player name…"
            style={{ flex:1, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, color:T.text, padding:"10px 12px", fontFamily:mono, fontSize:14, outline:"none" }} />
          <Btn T={T} onClick={addPlayer} style={{ padding:"10px 16px" }}>Add</Btn>
        </div>
        {newName.trim() && (
          <Card T={T} style={{ marginBottom:12 }}>
            <ThemePicker value={newTheme} onChange={setNewTheme} T={T} />
          </Card>
        )}
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {names.map(name=>(
            <div key={name} style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 10px" }}>
                <span style={{ width:10, height:10, borderRadius:"50%", background:THEMES[getSavedTheme(name)].accent, display:"inline-block", flexShrink:0 }} />
                <span onClick={()=>{ setEditThemePlayer(editThemePlayer===name?null:name); setRenamingPlayer(null); }} style={{ fontSize:13, fontWeight:600, cursor:"pointer", textDecoration:"underline dotted", textUnderlineOffset:3 }}>{name}</span>
                <button onClick={()=>{ setRenamingPlayer(renamingPlayer===name?null:name); setRenameValue(name); setEditThemePlayer(null); }} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:11, fontFamily:mono, padding:"0 2px", letterSpacing:"0.03em" }} title="Rename">✏️</button>
                <button onClick={()=>removePlayer(name)} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:14, lineHeight:1, padding:"0 2px" }}>×</button>
              </div>
              {renamingPlayer===name && (
                <div style={{ display:"flex", gap:6, marginTop:2 }}>
                  <input value={renameValue} onChange={e=>setRenameValue(e.target.value)}
                    onKeyDown={e=>{ if(e.key==="Enter") renamePlayer(name, renameValue); if(e.key==="Escape") setRenamingPlayer(null); }}
                    style={{ flex:1, background:T.surface, border:`1px solid ${T.accent}`, borderRadius:6, color:T.text, padding:"6px 10px", fontFamily:mono, fontSize:13, outline:"none" }}
                    autoFocus />
                  <button onClick={()=>renamePlayer(name, renameValue)} style={{ background:T.accent, border:"none", borderRadius:6, color:"#111", fontFamily:mono, fontWeight:700, fontSize:12, padding:"6px 10px", cursor:"pointer" }}>Save</button>
                  <button onClick={()=>setRenamingPlayer(null)} style={{ background:"none", border:`1px solid ${T.border}`, borderRadius:6, color:T.muted, fontFamily:mono, fontSize:12, padding:"6px 10px", cursor:"pointer" }}>Cancel</button>
                </div>
              )}
              {editThemePlayer===name && (
                <Card T={T} style={{ marginBottom:4 }}>
                  <ThemePicker value={getSavedTheme(name)} onChange={themeId => { saveThemeLocally(name, themeId); setEditThemePlayer(null); }} T={T} />
                </Card>
              )}
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}