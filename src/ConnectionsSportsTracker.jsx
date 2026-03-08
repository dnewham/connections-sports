import { useState, useEffect, useCallback } from "react";

// ── Color definitions ──────────────────────────────────────────────────────
const COLOR = {
  yellow: { bg: "#F5C842", text: "#1a1a1a", emoji: ["🟡","🟨"], label: "Yellow" },
  blue:   { bg: "#5B9BD5", text: "#fff",    emoji: ["🔵","🟦"], label: "Blue"   },
  green:  { bg: "#6DBF6D", text: "#1a1a1a", emoji: ["🟢","🟩"], label: "Green"  },
  purple: { bg: "#A855C8", text: "#fff",    emoji: ["🟣","🟪"], label: "Purple" },
};

// ── Share-text parser ──────────────────────────────────────────────────────
function parseShareText(text) {
  const errors = [];
  const timeMatch = text.match(/Time:\s*(\d{1,2}):(\d{2})/i);
  if (!timeMatch) errors.push("Could not find Time (expected format MM:SS)");
  const rawSeconds = timeMatch ? parseInt(timeMatch[1]) * 60 + parseInt(timeMatch[2]) : 0;
  const rawTime = timeMatch ? `${timeMatch[1].padStart(2,"0")}:${timeMatch[2]}` : "??:??";
  const puzzleMatch = text.match(/puzzle\s*#?(\d+)/i);
  const puzzleNum = puzzleMatch ? puzzleMatch[1] : null;
  const diffMatch = text.match(/ranked\s+([a-z\s]+?)(?:\.|Average|\n|$)/i);
  const difficulty = diffMatch ? diffMatch[1].trim() : null;

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
  return { rawTime, rawSeconds, puzzleNum, difficulty, gridRows, errors };
}

// ── Scoring engine ─────────────────────────────────────────────────────────
function calcScore({ rawSeconds, gridRows }) {
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
  const fmt = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  return { adjustments, delta, finalSeconds, finalTime: fmt(finalSeconds) };
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
  // Returns "YYYY-Www" for a given YYYY-MM-DD date, Mon-Sun weeks
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay(); // 0=Sun
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7)); // back to Monday
  const year = mon.getFullYear();
  const startOfYear = new Date(year, 0, 1);
  const weekNum = Math.ceil(((mon - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
  return `${year}-W${String(weekNum).padStart(2,"0")}`;
}

function todayStr() { return new Date().toISOString().slice(0,10); }
function thisWeekStr() { return getISOWeek(todayStr()); }

// ── Leaderboard helpers ────────────────────────────────────────────────────
const fmt = s => s == null ? "—:—" : `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;

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
  return players.map(name => ({ name, ...getPlayerStats(games, name) }))
    .sort((a,b) => {
      if (a.bestFinal==null&&b.bestFinal==null) return 0;
      if (a.bestFinal==null) return 1;
      if (b.bestFinal==null) return -1;
      return a.bestFinal-b.bestFinal;
    });
}

// Daily leaderboard: for a given date, rank players by finalSeconds ASC,
// tiebreak by submittedAt ASC (timestamp recorded at save time)
function getDailyLeaderboard(games, players, dateStr) {
  const dayGames = games.filter(g => g.date === dateStr);
  const entries = [];
  for (const name of players) {
    for (const game of dayGames) {
      const p = game.players.find(e => e.name === name);
      if (p) entries.push({ name, finalSeconds: p.finalSeconds, submittedAt: p.submittedAt || 0, finalTime: p.finalTime });
    }
  }
  return entries.sort((a,b) => {
    if (a.finalSeconds !== b.finalSeconds) return a.finalSeconds - b.finalSeconds;
    return a.submittedAt - b.submittedAt; // tiebreak: first to submit
  });
}

// Weekly leaderboard: Mon-Sun week identified by ISO week string
// Winner = most daily wins; tiebreak = lowest cumulative adjusted time
function getWeeklyLeaderboard(games, players, weekStr) {
  const weekGames = games.filter(g => g.date && getISOWeek(g.date) === weekStr);
  // Get all unique dates in this week
  const dates = [...new Set(weekGames.map(g => g.date))].sort();

  const stats = {};
  for (const name of players) stats[name] = { name, wins: 0, cumSeconds: 0, played: 0 };

  for (const date of dates) {
    const ranked = getDailyLeaderboard(weekGames, players, date);
    if (ranked.length === 0) continue;
    const winner = ranked[0];
    if (stats[winner.name]) stats[winner.name].wins++;
    for (const entry of ranked) {
      if (stats[entry.name]) {
        stats[entry.name].cumSeconds += entry.finalSeconds;
        stats[entry.name].played++;
      }
    }
  }

  return Object.values(stats).sort((a,b) => {
    if (b.wins !== a.wins) return b.wins - a.wins; // more wins = better
    return a.cumSeconds - b.cumSeconds; // tiebreak: lower cumulative time
  });
}

// All-time daily wins per player
function getAllTimeDailyWins(games, players) {
  const wins = {};
  for (const name of players) wins[name] = 0;
  const dates = [...new Set(games.map(g => g.date).filter(Boolean))].sort();
  for (const date of dates) {
    const ranked = getDailyLeaderboard(games, players, date);
    if (ranked.length > 0 && wins[ranked[0].name] != null) wins[ranked[0].name]++;
  }
  return players.map(name => ({ name, wins: wins[name] })).sort((a,b) => b.wins - a.wins);
}

// All-time weekly wins per player
function getAllTimeWeeklyWins(games, players) {
  const wins = {};
  for (const name of players) wins[name] = 0;
  const weeks = [...new Set(games.map(g => g.date ? getISOWeek(g.date) : null).filter(Boolean))];
  for (const week of weeks) {
    const ranked = getWeeklyLeaderboard(games, players, week);
    if (ranked.length > 0 && ranked[0].wins > 0 && wins[ranked[0].name] != null) wins[ranked[0].name]++;
  }
  return players.map(name => ({ name, wins: wins[name] })).sort((a,b) => b.wins - a.wins);
}

// ── Design tokens ──────────────────────────────────────────────────────────
const T = { bg:"#0e0e12", surface:"#16161d", border:"#242430", text:"#e8e4f0", muted:"#6b6880", accent:"#F5C842", win:"#6DBF6D", loss:"#e07070" };
const mono = "'DM Mono','Fira Mono',monospace";
const display = "'DM Mono','Fira Mono',monospace";

// ── Shared UI ──────────────────────────────────────────────────────────────
function Screen({ title, onBack, children }) {
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
function Card({ children, style, onClick }) {
  return <div onClick={onClick} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:12, padding:16, cursor:onClick?"pointer":undefined, ...style }}>{children}</div>;
}
function Btn({ children, onClick, variant="primary", disabled, style }) {
  const base = { fontFamily:mono, fontWeight:700, fontSize:14, borderRadius:9, cursor:disabled?"not-allowed":"pointer", border:"none", padding:"12px 18px", letterSpacing:"0.05em", opacity:disabled?0.45:1, transition:"opacity .15s", ...style };
  const variants = { primary:{ background:T.accent, color:"#111" }, ghost:{ background:T.surface, color:T.text, border:`1px solid ${T.border}` } };
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
function ParsePreview({ parsed, score }) {
  const { rawTime, puzzleNum, difficulty, gridRows } = parsed;
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
            <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:a.seconds>0?T.loss:T.win, padding:"3px 0" }}>
              <span>Rule {a.rule}: {a.label}</span>
              <span style={{ fontFamily:display, fontWeight:700 }}>{a.seconds>0?`+${a.seconds}s`:`${a.seconds}s`}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize:12, color:T.muted, textAlign:"center" }}>No adjustments — clean base time!</div>
      )}
    </div>
  );
}

// ── Bar Chart ──────────────────────────────────────────────────────────────
function WinsBarChart({ data, label }) {
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

// ── Tab Bar ────────────────────────────────────────────────────────────────
function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display:"flex", gap:4, background:T.surface, borderRadius:10, padding:4, marginBottom:16 }}>
      {tabs.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          flex:1, padding:"8px 4px", border:"none", borderRadius:7, cursor:"pointer", fontFamily:mono,
          fontSize:11, fontWeight:700, letterSpacing:"0.04em", textTransform:"uppercase",
          background: active===t.id ? T.accent : "transparent",
          color: active===t.id ? "#111" : T.muted,
          transition:"all .15s"
        }}>{t.label}</button>
      ))}
    </div>
  );
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
  const [lbTab, setLbTab]           = useState("daily");

  useEffect(() => { loadData().then(setData); }, []);
  const persist = useCallback(async next => { setSaving(true); setData(next); await saveData(next); setSaving(false); }, []);

  const addPlayer = () => {
    const name = newName.trim();
    if (!name || !data || data.players.includes(name)) return;
    persist({ ...data, players: [...data.players, name] });
    setNewName("");
  };
  const removePlayer = name => {
    if (!window.confirm(`Remove ${name}? Their game history will be kept.`)) return;
    persist({ ...data, players: data.players.filter(p => p !== name) });
  };
  const handleParse = () => {
    const p = parseShareText(pasteText);
    if (p.errors.length) { setParseError(p.errors); setParsed(null); setScore(null); return; }
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
      submittedAt: Date.now(), // for daily tiebreaking
    };
    const today = new Date().toISOString().slice(0,10);
    const gameId = parsed.puzzleNum ? `puzzle-${parsed.puzzleNum}` : `date-${today}`;
    const games = [...data.games];
    const existingIdx = games.findIndex(g => g.id === gameId);
    if (existingIdx >= 0) {
      games[existingIdx] = { ...games[existingIdx], players: [...games[existingIdx].players.filter(p=>p.name!==logPlayer), entry] };
    } else {
      games.unshift({ id:gameId, date:today, puzzleNum:parsed.puzzleNum, difficulty:parsed.difficulty, players:[entry] });
    }
    await persist({ ...data, games });
    setLogStep("pick"); setLogPlayer(null); setPasteText(""); setParsed(null); setScore(null); setScreen("home");
  };

  if (!data) return <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", color:T.muted, fontFamily:mono }}>Loading…</div>;

  // ── LOG: pick player ────────────────────────────────────────────────────
  if (screen==="log" && logStep==="pick") return (
    <Screen title="Log a Result" onBack={() => setScreen("home")}>
      <div style={{ marginTop:20 }}>
        <div style={{ fontSize:12, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:12 }}>Who's logging?</div>
        {data.players.length===0 && <div style={{ color:T.muted, fontSize:13, textAlign:"center", padding:30 }}>No players yet — add some from the home screen.</div>}
        {data.players.map(name => (
          <Card key={name} onClick={() => { setLogPlayer(name); setLogStep("paste"); }} style={{ marginBottom:10, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontWeight:700, fontSize:15 }}>{name}</span>
            <span style={{ color:T.muted, fontSize:18 }}>→</span>
          </Card>
        ))}
      </div>
    </Screen>
  );

  // ── LOG: paste share text ───────────────────────────────────────────────
  if (screen==="log" && logStep==="paste") return (
    <Screen title={`Paste Result — ${logPlayer}`} onBack={() => setLogStep("pick")}>
      <div style={{ marginTop:20 }}>
        <div style={{ fontSize:12, color:T.muted, marginBottom:8 }}>Paste your share text from The Athletic Connections app:</div>
        <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setParseError([]); }}
          placeholder={"Connections: Sports Edition\nTime: 00:51\nMy stats are in! I solved puzzle #530…\n🟡🟡🔵🟣\n🔵🔵🔵🔵\n…"}
          style={{ width:"100%", minHeight:180, background:T.surface, border:`1px solid ${T.border}`, borderRadius:10, color:T.text, fontFamily:mono, fontSize:13, padding:12, resize:"vertical", boxSizing:"border-box", outline:"none", lineHeight:1.6 }} />
        {parseError.length>0 && (
          <div style={{ background:"#1e1010", border:`1px solid #3a1a1a`, borderRadius:8, padding:"10px 12px", marginTop:10 }}>
            {parseError.map((e,i) => <div key={i} style={{ fontSize:12, color:T.loss }}>⚠ {e}</div>)}
          </div>
        )}
        <Btn onClick={handleParse} disabled={!pasteText.trim()} style={{ width:"100%", marginTop:14 }}>Parse Results →</Btn>
      </div>
    </Screen>
  );

  // ── LOG: review ─────────────────────────────────────────────────────────
  if (screen==="log" && logStep==="review" && parsed && score) return (
    <Screen title={`Review — ${logPlayer}`} onBack={() => setLogStep("paste")}>
      <div style={{ marginTop:20 }}>
        <Card style={{ marginBottom:14 }}><ParsePreview parsed={parsed} score={score} /></Card>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <Btn variant="ghost" onClick={() => setLogStep("paste")}>← Re-paste</Btn>
          <Btn onClick={submitEntry} disabled={saving}>{saving?"Saving…":"Save ✓"}</Btn>
        </div>
      </div>
    </Screen>
  );

  // ── LEADERBOARD ─────────────────────────────────────────────────────────
  if (screen==="leaderboard") {
    const today = todayStr();
    const thisWeek = thisWeekStr();
    const dailyRanked  = getDailyLeaderboard(data.games, data.players, today);
    const weeklyRanked = getWeeklyLeaderboard(data.games, data.players, thisWeek);
    const allTimeLb    = getLeaderboard(data.games, data.players);

    return (
      <Screen title="Leaderboard" onBack={() => setScreen("home")}>
        <div style={{ marginTop:16 }}>
          <Tabs
            tabs={[{ id:"daily", label:"Today" }, { id:"weekly", label:"This Week" }, { id:"alltime", label:"All Time" }]}
            active={lbTab}
            onChange={setLbTab}
          />

          {/* ── DAILY TAB ── */}
          {lbTab==="daily" && (
            <div>
              <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginBottom:14 }}>{today} · lowest adjusted time wins</div>
              {dailyRanked.length===0 && <div style={{ color:T.muted, textAlign:"center", padding:40, fontSize:13 }}>No results logged today yet.</div>}
              {dailyRanked.map((p,idx) => (
                <Card key={p.name} style={{ marginBottom:10, borderColor:idx===0?`${T.accent}40`:T.border }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ fontSize:20, minWidth:28 }}>{["🥇","🥈","🥉"][idx]||`${idx+1}.`}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:15 }}>{p.name}</div>
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

          {/* ── WEEKLY TAB ── */}
          {lbTab==="weekly" && (
            <div>
              <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginBottom:14 }}>Week of {thisWeek} · Mon–Sun</div>
              {weeklyRanked.every(p=>p.played===0) && <div style={{ color:T.muted, textAlign:"center", padding:40, fontSize:13 }}>No results logged this week yet.</div>}
              {weeklyRanked.filter(p=>p.played>0).map((p,idx) => (
                <Card key={p.name} style={{ marginBottom:10, borderColor:idx===0?`${T.accent}40`:T.border }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <div style={{ fontSize:20, minWidth:28 }}>{["🥇","🥈","🥉"][idx]||`${idx+1}.`}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:15 }}>{p.name}</div>
                      <div style={{ fontSize:11, color:T.muted, marginTop:3 }}>{p.played} day{p.played!==1?"s":""} played · {fmt(p.cumSeconds)} cumulative</div>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ fontFamily:display, fontWeight:800, fontSize:24, color:T.accent }}>{p.wins}</div>
                      <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.06em", textTransform:"uppercase" }}>Daily Wins</div>
                    </div>
                  </div>
                </Card>
              ))}
              {weeklyRanked.some(p=>p.played>0) && <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginTop:8 }}>Tiebreak: lowest cumulative time</div>}
            </div>
          )}

          {/* ── ALL TIME TAB ── */}
          {lbTab==="alltime" && (
            <div>
              {/* Best time leaderboard */}
              <div style={{ marginBottom:20 }}>
                <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>Best Time</div>
                {allTimeLb.map((p,idx) => (
                  <Card key={p.name} onClick={() => { setDetail(p.name); setScreen("playerDetail"); }} style={{ marginBottom:8, borderColor:idx===0?`${T.accent}40`:T.border }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ fontSize:18, minWidth:28 }}>{["🥇","🥈","🥉"][idx]||`${idx+1}.`}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontWeight:700, fontSize:14 }}>{p.name}</div>
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

              {/* Win charts */}
              <Card style={{ marginBottom:12 }}>
                <WinsBarChart data={getAllTimeDailyWins(data.games, data.players)} label="All-Time Daily Wins" />
              </Card>
              <Card>
                <WinsBarChart data={getAllTimeWeeklyWins(data.games, data.players)} label="All-Time Weekly Wins" />
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
    const dailyWins = getAllTimeDailyWins(data.games, data.players).find(p=>p.name===detail)?.wins || 0;
    const weeklyWins = getAllTimeWeeklyWins(data.games, data.players).find(p=>p.name===detail)?.wins || 0;
    return (
      <Screen title={detail} onBack={() => setScreen("leaderboard")}>
        <div style={{ marginTop:16 }}>
          <Card style={{ marginBottom:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:8, textAlign:"center" }}>
              {[["Games",stats.played],["Best",stats.fmtBest],["Daily W",dailyWins],["Weekly W",weeklyWins]].map(([l,v])=>(
                <div key={l}>
                  <div style={{ fontFamily:display, fontWeight:800, fontSize:18, color:T.accent }}>{v}</div>
                  <div style={{ fontSize:9, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:3 }}>{l}</div>
                </div>
              ))}
            </div>
          </Card>
          <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", margin:"16px 0 8px" }}>Game History</div>
          {playerGames.map(game => {
            const entry = game.players.find(p => p.name===detail);
            return (
              <Card key={game.id} style={{ marginBottom:8 }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                  <div>
                    <div style={{ fontSize:12, color:T.muted }}>{game.puzzleNum?`Puzzle #${game.puzzleNum}`:game.date}{game.difficulty&&` · ${game.difficulty}`}</div>
                    <div style={{ display:"flex", gap:3, marginTop:6 }}>
                      {entry.gridRows?.map((row,i)=>(
                        <div key={i} style={{ display:"flex", gap:2 }}>{row.map((c,j)=><ColorDot key={j} color={c} size={10}/>)}</div>
                      ))}
                    </div>
                    {entry.adjustments?.length>0 && (
                      <div style={{ marginTop:6, fontSize:11 }}>
                        {entry.adjustments.map((a,i)=>(
                          <span key={i} style={{ marginRight:8, color:a.seconds>0?T.loss:T.win }}>{a.label} ({a.seconds>0?`+${a.seconds}s`:`${a.seconds}s`})</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign:"right", marginLeft:12 }}>
                    <div style={{ fontFamily:display, fontWeight:800, fontSize:18, color:T.accent }}>{entry.finalTime}</div>
                    <div style={{ fontSize:10, color:T.muted, marginTop:2 }}>raw {entry.rawTime}</div>
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
  if (screen==="history") return (
    <Screen title="Game History" onBack={() => setScreen("home")}>
      <div style={{ marginTop:16 }}>
        {data.games.length===0 && <div style={{ color:T.muted, textAlign:"center", padding:40, fontSize:13 }}>No games logged yet.</div>}
        {data.games.map(game=>(
          <Card key={game.id} style={{ marginBottom:12 }}>
            <div style={{ fontSize:12, color:T.muted, marginBottom:10, display:"flex", justifyContent:"space-between" }}>
              <span>{game.puzzleNum?`Puzzle #${game.puzzleNum}`:game.date}</span>
              {game.difficulty&&<span style={{ textTransform:"capitalize" }}>{game.difficulty}</span>}
            </div>
            {game.players.map(entry=>(
              <div key={entry.name} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderTop:`1px solid ${T.border}` }}>
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{entry.name}</div>
                  <div style={{ display:"flex", gap:3, marginTop:4 }}>
                    {entry.gridRows?.map((row,i)=>(
                      <div key={i} style={{ display:"flex", gap:2 }}>{row.map((c,j)=><ColorDot key={j} color={c} size={9}/>)}</div>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
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

  // ── HOME ─────────────────────────────────────────────────────────────────
  const lb = getLeaderboard(data.games, data.players);
  const todayWinner = getDailyLeaderboard(data.games, data.players, todayStr())[0];
  const weekWinner  = getWeeklyLeaderboard(data.games, data.players, thisWeekStr()).find(p=>p.wins>0);
  return (
    <Screen title="🏆 MBA Friends Connections">
      <div style={{ marginTop:20 }}>
        {data.games.length>0 && (
          <Card style={{ marginBottom:20 }}>
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
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
          <Btn onClick={() => { setLogStep("pick"); setScreen("log"); }} disabled={data.players.length===0} style={{ gridColumn:"1/-1", padding:16, fontSize:16 }}>📋 Log a Result</Btn>
          <Btn variant="ghost" onClick={() => { setLbTab("daily"); setScreen("leaderboard"); }} style={{ padding:14 }}>🏆 Leaderboard</Btn>
          <Btn variant="ghost" onClick={() => setScreen("history")} style={{ padding:14 }}>📅 History</Btn>
        </div>
        {data.players.length===0 && <div style={{ textAlign:"center", color:T.muted, fontSize:13, marginBottom:20 }}>Add your players below to get started.</div>}
        <div style={{ fontSize:11, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginBottom:10 }}>Players</div>
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPlayer()} placeholder="Add player name…"
            style={{ flex:1, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, color:T.text, padding:"10px 12px", fontFamily:mono, fontSize:14, outline:"none" }} />
          <Btn onClick={addPlayer} style={{ padding:"10px 16px" }}>Add</Btn>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
          {data.players.map(name=>(
            <div key={name} style={{ display:"flex", alignItems:"center", gap:6, background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, padding:"6px 10px" }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{name}</span>
              <button onClick={()=>removePlayer(name)} style={{ background:"none", border:"none", color:T.muted, cursor:"pointer", fontSize:14, lineHeight:1, padding:"0 2px" }}>×</button>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  );
}
