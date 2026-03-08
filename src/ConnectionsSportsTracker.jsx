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
// Rule A: Each mixed-color row (incorrect guess) → +5 seconds
// Rule B: Row 1 is all Purple → −15 seconds
// Rule C: Row 1 is all Blue → −5 seconds
// Rule D: Row 2 is all Purple → −10 seconds
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

// ── Leaderboard helpers ────────────────────────────────────────────────────
function getPlayerStats(games, name) {
  const entries = games.filter(g => g.players.some(p => p.name === name)).map(g => g.players.find(p => p.name === name));
  const finalTimes = entries.map(e => e.finalSeconds).filter(n => n != null);
  const bestFinal = finalTimes.length ? Math.min(...finalTimes) : null;
  const avgFinal  = finalTimes.length ? Math.round(finalTimes.reduce((a,b)=>a+b,0)/finalTimes.length) : null;
  const fmt = s => s == null ? "—:—" : `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  return { played: entries.length, bestFinal, avgFinal, fmtBest: fmt(bestFinal), fmtAvg: fmt(avgFinal) };
}
function getLeaderboard(games, players) {
  return players.map(name => ({ name, ...getPlayerStats(games, name) }))
    .sort((a,b) => { if (a.bestFinal==null&&b.bestFinal==null) return 0; if (a.bestFinal==null) return 1; if (b.bestFinal==null) return -1; return a.bestFinal-b.bestFinal; });
}

// ── Design tokens ──────────────────────────────────────────────────────────
const T = { bg:"#0e0e12", surface:"#16161d", border:"#242430", text:"#e8e4f0", muted:"#6b6880", accent:"#F5C842", win:"#6DBF6D", loss:"#e07070" };
const mono = "'DM Mono','Fira Mono',monospace";
const display = "'Syne','DM Mono',monospace";

// ── Shared UI ──────────────────────────────────────────────────────────────
function Screen({ title, onBack, children }) {
  return (
    <div style={{ minHeight:"100vh", background:T.bg, color:T.text, fontFamily:mono }}>
      <div style={{ maxWidth:480, margin:"0 auto", padding:"0 16px 80px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"18px 0 14px", borderBottom:`1px solid ${T.border}` }}>
          {onBack && <button onClick={onBack} style={{ background:"none", border:"none", color:T.muted, fontSize:20, cursor:"pointer", padding:"2px 10px 2px 0" }}>←</button>}
          <h1 style={{ margin:0, fontFamily:display, fontSize:11, fontWeight:800, letterSpacing:"0.04em", textTransform:"uppercase", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{title}</h1>
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

// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [data, setData]           = useState(null);
  const [screen, setScreen]       = useState("home");
  const [detail, setDetail]       = useState(null);
  const [saving, setSaving]       = useState(false);
  const [logStep, setLogStep]     = useState("pick");
  const [logPlayer, setLogPlayer] = useState(null);
  const [pasteText, setPasteText] = useState("");
  const [parsed, setParsed]       = useState(null);
  const [score, setScore]         = useState(null);
  const [parseError, setParseError] = useState([]);
  const [newName, setNewName]     = useState("");

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
    const lb = getLeaderboard(data.games, data.players);
    return (
      <Screen title="Leaderboard" onBack={() => setScreen("home")}>
        <div style={{ marginTop:16 }}>
          {lb.length===0 && <div style={{ color:T.muted, textAlign:"center", padding:40, fontSize:13 }}>No games logged yet.</div>}
          {lb.map((p,idx) => (
            <Card key={p.name} onClick={() => { setDetail(p.name); setScreen("playerDetail"); }} style={{ marginBottom:10, borderColor:idx===0?"#F5C84240":T.border }}>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <div style={{ fontSize:20, minWidth:28 }}>{["🥇","🥈","🥉"][idx]||`${idx+1}.`}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:15 }}>{p.name}</div>
                  <div style={{ fontSize:11, color:T.muted, marginTop:3 }}>{p.played} game{p.played!==1?"s":""} · avg {p.fmtAvg}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontFamily:display, fontWeight:800, fontSize:20, color:T.accent }}>{p.fmtBest}</div>
                  <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.06em", textTransform:"uppercase" }}>Best</div>
                </div>
              </div>
            </Card>
          ))}
          {lb.length>0 && <div style={{ fontSize:11, color:T.muted, textAlign:"center", marginTop:8 }}>Lowest final time wins · tap for details</div>}
        </div>
      </Screen>
    );
  }

  // ── PLAYER DETAIL ───────────────────────────────────────────────────────
  if (screen==="playerDetail" && detail) {
    const stats = getPlayerStats(data.games, detail);
    const playerGames = data.games.filter(g => g.players.some(p => p.name===detail));
    return (
      <Screen title={detail} onBack={() => setScreen("leaderboard")}>
        <div style={{ marginTop:16 }}>
          <Card style={{ marginBottom:12 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, textAlign:"center" }}>
              {[["Games",stats.played],["Best",stats.fmtBest],["Avg",stats.fmtAvg]].map(([l,v])=>(
                <div key={l}>
                  <div style={{ fontFamily:display, fontWeight:800, fontSize:22, color:T.accent }}>{v}</div>
                  <div style={{ fontSize:10, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:3 }}>{l}</div>
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
  return (
    <Screen title="🏆 MBA Friends Connections">
      <div style={{ marginTop:20 }}>
        {data.games.length>0 && (
          <Card style={{ marginBottom:20 }}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8, textAlign:"center" }}>
              <div><div style={{ fontFamily:display, fontWeight:800, fontSize:26, color:T.accent }}>{data.games.length}</div><div style={{ fontSize:10, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:3 }}>Games</div></div>
              <div><div style={{ fontFamily:display, fontWeight:800, fontSize:26, color:T.accent }}>{data.players.length}</div><div style={{ fontSize:10, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:3 }}>Players</div></div>
              <div><div style={{ fontFamily:display, fontWeight:800, fontSize:16, color:T.accent, lineHeight:1.2, marginTop:4 }}>{lb[0]?.name?.split(" ")[0]||"—"}</div><div style={{ fontSize:10, color:T.muted, letterSpacing:"0.07em", textTransform:"uppercase", marginTop:5 }}>Leading</div></div>
            </div>
          </Card>
        )}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:20 }}>
          <Btn onClick={() => { setLogStep("pick"); setScreen("log"); }} disabled={data.players.length===0} style={{ gridColumn:"1/-1", padding:16, fontSize:16 }}>📋 Log a Result</Btn>
          <Btn variant="ghost" onClick={() => setScreen("leaderboard")} style={{ padding:14 }}>🏆 Leaderboard</Btn>
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
