import React, { useState, useRef, useEffect } from "react";
import PPTPreview from "./PPTPreview";
import SlideChat from "./SlideChat";

const STEP_ICONS = { analysing: "🔬", strategising: "🧠", writing: "✍️", validating: "🔍", formatting: "✨" };

const TONES = ["General", "Executive", "Technical", "Sales"];

export default function ChatWindow({ sessionId, apiBase }) {
  const [rawData, setRawData]               = useState("");
  const [tone, setTone]                     = useState("General");
  const [messages, setMessages]             = useState([]);
  const [loading, setLoading]               = useState(false);
  const [steps, setSteps]                   = useState([]);
  const [slideHistories, setSlideHistories] = useState({});
  const [slideChat, setSlideChat]           = useState(null);
  const [creatingPPT, setCreatingPPT]       = useState(false);
  const [previewSlides, setPreviewSlides]   = useState(null);
  const bottomRef = useRef();

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, steps]);

  const handleSubmit = async () => {
    if (!rawData.trim() || loading) return;
    const text = rawData;
    setMessages((p) => [...p, { role: "user", text }]);
    setRawData(""); setLoading(true); setSteps([]);
    try {
      const res = await fetch(`${apiBase}/process-data`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, raw_data: text, tone }),
      });
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const chunk = JSON.parse(line.slice(6));
          if (chunk.type === "step") { setSteps((p) => [...p, chunk]); }
          else if (chunk.type === "result") {
            const seen = new Set();
            const slides = (chunk.data.slides || []).filter((sl) => {
              if (seen.has(sl.slide_number)) return false; seen.add(sl.slide_number); return true;
            });
            setMessages((p) => [...p, {
              role: "bot", slides, askPPT: true,
              qualityScore: chunk.data.quality_score,
              issuesFound:  chunk.data.issues_found,
              tone:         chunk.data.tone,
            }]); setSteps([]);
          } else if (chunk.type === "error") {
            setMessages((p) => [...p, { role: "bot", error: chunk.message }]); setSteps([]);
          }
        }
      }
    } catch { setMessages((p) => [...p, { role: "bot", error: "Connection error" }]); setSteps([]); }
    finally { setLoading(false); }
  };

  const handleCreatePPT = async (slides, idx) => {
    setCreatingPPT(true);
    setMessages((p) => p.map((m, i) => i === idx ? { ...m, askPPT: false, pptLoading: true } : m));
    try {
      const res = await fetch(`${apiBase}/create-ppt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, slides }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Failed"); }
      const url = URL.createObjectURL(await res.blob());
      setMessages((p) => p.map((m, i) => i === idx ? { ...m, pptLoading: false, downloadUrl: url } : m));
    } catch (e) {
      setMessages((p) => p.map((m, i) => i === idx ? { ...m, pptLoading: false, pptError: e.message } : m));
    } finally { setCreatingPPT(false); }
  };

  const handleDeclinePPT = (idx) =>
    setMessages((p) => p.map((m, i) => i === idx ? { ...m, askPPT: false } : m));

  const handlePreview = async (slides, idx) => {
    setMessages((p) => p.map((m, i) => i === idx ? { ...m, previewLoading: true } : m));
    try {
      const res = await fetch(`${apiBase}/preview-ppt`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, slides }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || "Preview failed"); }
      const data = await res.json();
      setMessages((p) => p.map((m, i) => i === idx ? { ...m, previewLoading: false } : m));
      setPreviewSlides(data.slides);
    } catch (e) {
      setMessages((p) => p.map((m, i) => i === idx ? { ...m, previewLoading: false, pptError: e.message } : m));
    }
  };

  const openSlideChat = (slide, msgIndex) => setSlideChat({ slide, msgIndex });

  const onApply = (slideNumber, refinedContent, msgIndex) => {
    setSlideChat(null);
    setMessages((p) => p.map((m, i) => {
      if (i !== msgIndex) return m;
      const seen = new Set();
      const deduped = m.slides.filter((sl) => { if (seen.has(sl.slide_number)) return false; seen.add(sl.slide_number); return true; });
      return { ...m, slides: deduped.map((sl) => sl.slide_number === slideNumber ? { ...sl, suggested_content: refinedContent } : sl) };
    }));
  };

  return (
    <div style={s.root}>
      <div style={s.topBar}>
        <div style={s.topLeft}>
          <div style={s.onlineDot} />
          <span style={s.topTitle}>Content Mapper</span>
        </div>
        <span style={s.topHint}>Paste raw data → AI maps it to your slides</span>
      </div>

      <div style={s.messages}>
        {messages.length === 0 && !loading && <EmptyState onExample={(t) => setRawData(t)} />}
        {messages.map((msg, i) => (
          <div key={i} style={{ animation: "fadeIn 0.25s ease" }}>
            {msg.role === "user" && <UserBubble text={msg.text} />}
            {msg.role === "bot" && (
              <BotBubble
                slides={msg.slides} error={msg.error} askPPT={msg.askPPT}
                pptLoading={msg.pptLoading} downloadUrl={msg.downloadUrl}
                pptError={msg.pptError} previewLoading={msg.previewLoading}
                qualityScore={msg.qualityScore} issuesFound={msg.issuesFound} tone={msg.tone}
                onSlideClick={(slide) => openSlideChat(slide, i)}
                onCreatePPT={() => handleCreatePPT(msg.slides, i)}
                onDeclinePPT={() => handleDeclinePPT(i)}
                onPreview={() => handlePreview(msg.slides, i)}
              />
            )}
          </div>
        ))}
        {loading && <AgentSteps steps={steps} />}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputBar}>
        <div style={s.inputWrap}>
          <div style={s.toneRow}>
            <span style={s.toneLabel}>Tone:</span>
            {TONES.map((t) => (
              <button
                key={t}
                onClick={() => setTone(t)}
                style={{ ...s.toneBtn, ...(tone === t ? s.toneBtnActive : {}) }}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            value={rawData} onChange={(e) => setRawData(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSubmit(); }}
            placeholder="Paste your raw content here — company info, stats, bullet points, anything…"
            style={s.textarea} rows={3}
          />
          <div style={s.inputActions}>
            <span style={s.shortcutHint}>Ctrl + Enter to send</span>
            <button onClick={handleSubmit} disabled={loading || !rawData.trim()}
              style={{ ...s.sendBtn, ...(loading || !rawData.trim() ? s.sendBtnOff : {}) }}>
              {loading ? <span style={s.spinner} /> : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              <span>{loading ? "Processing…" : "Send"}</span>
            </button>
          </div>
        </div>
      </div>

      {slideChat && (
        <SlideChat
          slide={slideChat.slide} history={slideHistories[slideChat.slide.slide_number] ?? []}
          sessionId={sessionId} apiBase={apiBase}
          onApply={(sn, rc) => onApply(sn, rc, slideChat.msgIndex)}
          onClose={() => setSlideChat(null)}
          onHistoryUpdate={(msgs) => setSlideHistories((p) => ({ ...p, [slideChat.slide.slide_number]: msgs }))}
        />
      )}
      {previewSlides && <PPTPreview slides={previewSlides} apiBase={apiBase} onClose={() => setPreviewSlides(null)} />}
    </div>
  );
}

// ── Empty State ──────────────────────────────────────────
const EXAMPLES = [
  "Our company TechCorp was founded in 2018. We build B2B SaaS tools for supply chain teams. Revenue: $2.4M ARR, 120 customers, 18 employees. Key product: AutoPlan — reduces planning time by 60%.",
  "Q3 Results: Revenue up 34% YoY. New customers: 47. Churn: 2.1%. Top market: Healthcare (38%). Product roadmap: AI forecasting (Q4), mobile app (Q1 next year).",
  "Problem: Manual Excel-based S&OP takes 3 days per cycle. Solution: Automated platform with real-time data sync. Benefits: 80% time saved, fewer errors, better cross-team visibility.",
];

function EmptyState({ onExample }) {
  return (
    <div style={es.wrap}>
      <div style={es.iconWrap}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
          <path d="M9 17H5a2 2 0 01-2-2V5a2 2 0 012-2h11a2 2 0 012 2v3" stroke="#4f46e5" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M13 21l2-2m0 0l4-4m-4 4l-2-2m2 2l4-4" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      <p style={es.title}>Ready to map your content</p>
      <p style={es.sub}>Paste any raw text and the AI will intelligently distribute it across your slide template.</p>
      <p style={es.examplesLabel}>Try an example</p>
      <div style={es.examples}>
        {EXAMPLES.map((ex, i) => (
          <button key={i} style={es.exBtn} onClick={() => onExample(ex)}>
            <span style={es.exNum}>{i + 1}</span>
            <span style={es.exText}>{ex.slice(0, 72)}…</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── User Bubble ──────────────────────────────────────────
function UserBubble({ text }) {
  return (
    <div style={ub.row}>
      <div style={ub.bubble}><p style={ub.text}>{text}</p></div>
      <div style={ub.avatar}>You</div>
    </div>
  );
}

// ── Agent Steps ──────────────────────────────────────────
function AgentSteps({ steps }) {
  const allSteps = ["analysing", "strategising", "writing", "validating", "formatting"];
  // A step is "done" when we've received a status:"done" event for it
  const doneSet  = new Set(steps.filter((s) => s.status === "done").map((s) => s.step));
  // Current = last step with status:"running"
  const running  = steps.filter((s) => s.status === "running");
  const current  = running.length > 0 ? running[running.length - 1] : null;
  return (
    <div style={as.row}>
      <div style={bb.avatar}>AI</div>
      <div style={as.card}>
        <p style={as.title}>AGENT IS WORKING</p>
        <div style={as.steps}>
          {allSteps.map((key, i) => {
            const done   = doneSet.has(key);
            const active = current?.step === key;
            return (
              <div key={key} style={as.stepRow}>
                <div style={{ ...as.dot, ...(done ? as.dotDone : active ? as.dotActive : as.dotPending) }}>
                  {done ? "✓" : active ? <span style={as.spinnerDot} /> : <span style={as.dotNum}>{i + 1}</span>}
                </div>
                <div style={as.stepContent}>
                  <span style={{ ...as.stepLabel, ...(done ? as.labelDone : active ? as.labelActive : as.labelPending) }}>
                    {STEP_ICONS[key]} {steps.find((s) => s.step === key)?.label || key}
                  </span>
                  {active && <span style={as.activePill}>Running</span>}
                  {done   && <span style={as.donePill}>Done</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Bot Bubble ───────────────────────────────────────────
function BotBubble({ slides, error, askPPT, pptLoading, downloadUrl, pptError, previewLoading,
  qualityScore, issuesFound, tone,
  onSlideClick, onCreatePPT, onDeclinePPT, onPreview }) {
  return (
    <div style={bb.row}>
      <div style={bb.avatar}>AI</div>
      <div style={bb.content}>
        {error ? (
          <div style={bb.error}>⚠ {error}</div>
        ) : (
          <>
            <div style={bb.introRow}>
              <p style={bb.intro}>Mapped content to <strong style={{ color: "#818cf8" }}>{slides.length} slides</strong></p>
              <div style={bb.introBadges}>
                {qualityScore != null && (
                  <span style={{ ...bb.qualityBadge, ...(qualityScore >= 8 ? bb.qualityGood : bb.qualityWarn) }}>
                    {qualityScore >= 8 ? "✓" : "⚠"} Quality {qualityScore}/10
                  </span>
                )}
                {issuesFound > 0 && (
                  <span style={bb.fixedBadge}>🔧 {issuesFound} issue{issuesFound > 1 ? "s" : ""} auto-fixed</span>
                )}
                {tone && tone !== "General" && (
                  <span style={bb.toneBadge}>🎯 {tone}</span>
                )}
                <span style={bb.introHint}>Click any card to refine →</span>
              </div>
            </div>

            <div style={bb.grid}>
              {slides.map((slide) => (
                <SlideCard key={slide.slide_number} slide={slide} onClick={() => onSlideClick(slide)} />
              ))}
            </div>

            {askPPT && (
              <div style={pq.box}>
                <div style={pq.boxLeft}>
                  <div style={pq.pptIcon}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round"/>
                      <path d="M14 2v6h6" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <p style={pq.question}>Generate PowerPoint file?</p>
                    <p style={pq.sub}>Fills your template with the mapped content, preserving your design.</p>
                  </div>
                </div>
                <div style={pq.actions}>
                  <button onClick={onCreatePPT} style={pq.yesBtn}>Generate PPT</button>
                  <button onClick={onDeclinePPT} style={pq.noBtn}>Skip</button>
                </div>
              </div>
            )}

            {pptLoading && (
              <div style={pq.loadingBox}>
                <span style={s.spinner} />
                <span style={pq.loadingText}>Building your PowerPoint…</span>
              </div>
            )}

            {downloadUrl && (
              <div style={pq.downloadBox}>
                <div style={pq.downloadLeft}>
                  <div style={pq.dlIconWrap}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  <div>
                    <p style={pq.downloadTitle}>Your PPT is ready</p>
                    <p style={pq.downloadSub}>Same design as your template, filled with mapped content.</p>
                  </div>
                </div>
                <div style={pq.downloadActions}>
                  <button onClick={onPreview} disabled={previewLoading}
                    style={{ ...pq.previewBtn, ...(previewLoading ? pq.btnOff : {}) }}>
                    {previewLoading ? <><span style={s.spinner} /> Rendering…</> : <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2"/>
                        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                      </svg> Preview</>}
                  </button>
                  <a href={downloadUrl} download="SlideAI_Output.pptx" style={pq.downloadBtn}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Download .pptx
                  </a>
                </div>
              </div>
            )}

            {pptError && <div style={bb.error}>⚠ PPT creation failed: {pptError}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ── Slide Card ───────────────────────────────────────────
function SlideCard({ slide, onClick }) {
  const [hovered, setHovered] = useState(false);
  const lines = slide.suggested_content?.split("\n").filter(Boolean) || [];
  const conf  = slide.confidence ?? 1.0;
  const confColor = conf >= 0.8 ? "#34d399" : conf >= 0.5 ? "#fbbf24" : "#f87171";
  const confLabel = conf >= 0.8 ? "High" : conf >= 0.5 ? "Medium" : "Low";
  return (
    <div
      style={{ ...sc.card, ...(hovered ? sc.cardHover : {}), ...(conf < 0.5 ? sc.cardLowConf : {}) }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ ...sc.accent, background: conf < 0.5 ? "linear-gradient(180deg,#f87171,#fbbf24)" : "linear-gradient(180deg,#818cf8,#c084fc)" }} />
      <div style={sc.head}>
        <span style={sc.badge}>Slide {slide.slide_number}</span>
        <span style={sc.title}>{slide.slide_title}</span>
        <span style={{ ...sc.confBadge, color: confColor, borderColor: confColor + "44", background: confColor + "11" }}>
          {confLabel}
        </span>
        <span style={{ ...sc.editHint, ...(hovered ? sc.editHintVisible : {}) }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Refine
        </span>
      </div>
      <div style={sc.body}>
        {lines.slice(0, 3).map((line, i) => (
          <div key={i} style={sc.line}>
            {line.startsWith("- ") ? (
              <><span style={sc.bullet} /><span style={sc.lineText}>{line.slice(2)}</span></>
            ) : (
              <span style={sc.lineText}>{line}</span>
            )}
          </div>
        ))}
        {lines.length > 3 && <p style={sc.more}>+{lines.length - 3} more lines</p>}
        {lines.length === 0 && <p style={sc.empty}>No content mapped</p>}
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────
const s = {
  root: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
  topBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 28px", borderBottom: "1px solid rgba(99,102,241,0.1)",
    background: "rgba(10,15,30,0.7)", backdropFilter: "blur(12px)",
    flexShrink: 0, flexWrap: "wrap", gap: 8,
  },
  topLeft: { display: "flex", alignItems: "center", gap: 10 },
  onlineDot: { width: 8, height: 8, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 8px rgba(52,211,153,0.7)" },
  topTitle: { fontSize: 14, fontWeight: 600, color: "#e2e8f0" },
  topHint: { fontSize: 12, color: "#475569" },
  messages: { flex: 1, overflowY: "auto", padding: "28px 36px", display: "flex", flexDirection: "column", gap: 24 },
  inputBar: { flexShrink: 0, padding: "14px 28px 20px", borderTop: "1px solid rgba(99,102,241,0.1)", background: "rgba(10,15,30,0.8)", backdropFilter: "blur(12px)" },
  inputWrap: { background: "rgba(15,23,42,0.95)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 16, overflow: "hidden" },
  textarea: { width: "100%", display: "block", background: "transparent", border: "none", padding: "14px 18px 8px", fontSize: 14, color: "#e2e8f0", resize: "none", fontFamily: "inherit", lineHeight: 1.6, outline: "none" },
  inputActions: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px 10px" },
  shortcutHint: { fontSize: 11, color: "#334155" },
  sendBtn: { display: "flex", alignItems: "center", gap: 7, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", border: "none", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 600, padding: "9px 18px", cursor: "pointer", boxShadow: "0 4px 14px rgba(99,102,241,0.35)" },
  sendBtnOff: { opacity: 0.4, cursor: "not-allowed", boxShadow: "none" },
  spinner: { width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff", borderRadius: "50%", display: "inline-block", animation: "spin 0.8s linear infinite" },
  toneRow: { display: "flex", alignItems: "center", gap: 6, padding: "10px 14px 0", flexWrap: "wrap" },
  toneLabel: { fontSize: 11, color: "#475569", fontWeight: 600, marginRight: 2 },
  toneBtn: {
    fontSize: 11, fontWeight: 500, padding: "4px 10px", borderRadius: 20, cursor: "pointer",
    background: "rgba(30,41,59,0.6)", border: "1px solid rgba(51,65,85,0.5)", color: "#64748b",
    transition: "all 0.15s",
  },
  toneBtnActive: {
    background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.4)", color: "#818cf8",
  },
};

const es = {
  wrap: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 20px 20px", gap: 20 },
  iconWrap: { width: 68, height: 68, borderRadius: 18, background: "rgba(79,70,229,0.08)", border: "1px solid rgba(79,70,229,0.18)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 30px rgba(79,70,229,0.1)" },
  title: { fontSize: 18, fontWeight: 700, color: "#cbd5e1" },
  sub: { fontSize: 13, color: "#475569", maxWidth: 400, lineHeight: 1.7, textAlign: "center" },
  examplesLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "#334155", textTransform: "uppercase", marginTop: 8 },
  examples: { display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 520 },
  exBtn: {
    display: "flex", alignItems: "flex-start", gap: 12, textAlign: "left",
    background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.12)",
    borderRadius: 12, padding: "12px 16px", cursor: "pointer",
    transition: "border-color 0.2s",
  },
  exNum: { width: 22, height: 22, borderRadius: "50%", background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  exText: { fontSize: 12, color: "#64748b", lineHeight: 1.6 },
};

const ub = {
  row: { display: "flex", justifyContent: "flex-end", alignItems: "flex-end", gap: 10 },
  bubble: { maxWidth: "65%", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", borderRadius: "18px 18px 4px 18px", padding: "12px 16px", boxShadow: "0 4px 20px rgba(99,102,241,0.25)" },
  text: { color: "#fff", fontSize: 14, lineHeight: 1.65, whiteSpace: "pre-wrap" },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 },
};

const bb = {
  row: { display: "flex", alignItems: "flex-start", gap: 12 },
  avatar: { width: 32, height: 32, borderRadius: "50%", background: "rgba(15,23,42,0.9)", border: "1px solid rgba(99,102,241,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#818cf8", flexShrink: 0, boxShadow: "0 0 12px rgba(99,102,241,0.15)" },
  content: { flex: 1, minWidth: 0 },
  introRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 6 },
  intro: { fontSize: 13, color: "#64748b" },
  introBadges: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  introHint: { fontSize: 11, color: "#334155" },
  qualityBadge: { fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "2px 8px", border: "1px solid" },
  qualityGood: { background: "rgba(52,211,153,0.1)", color: "#34d399", borderColor: "rgba(52,211,153,0.3)" },
  qualityWarn: { background: "rgba(251,191,36,0.1)", color: "#fbbf24", borderColor: "rgba(251,191,36,0.3)" },
  fixedBadge: { fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "2px 8px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8" },
  toneBadge:  { fontSize: 10, fontWeight: 700, borderRadius: 20, padding: "2px 8px", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)", color: "#c084fc" },
  grid: { display: "flex", flexDirection: "column", gap: 8 },
  error: { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 10, padding: "12px 16px", color: "#fca5a5", fontSize: 13 },
};

const sc = {
  card: { position: "relative", background: "rgba(15,23,42,0.75)", border: "1px solid rgba(99,102,241,0.1)", borderRadius: 12, padding: "14px 16px 14px 20px", overflow: "hidden", cursor: "pointer", transition: "border-color 0.2s, transform 0.15s, background 0.2s" },
  cardHover: { borderColor: "rgba(99,102,241,0.35)", transform: "translateY(-1px)", background: "rgba(15,23,42,0.9)" },
  cardLowConf: { borderColor: "rgba(251,191,36,0.2)" },
  accent: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "linear-gradient(180deg, #818cf8, #c084fc)", borderRadius: "3px 0 0 3px" },
  head: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" },
  badge: { background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.22)", color: "#818cf8", borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, flexShrink: 0 },
  title: { color: "#e2e8f0", fontWeight: 600, fontSize: 13, flex: 1 },
  confBadge: { fontSize: 9, fontWeight: 700, borderRadius: 20, padding: "2px 7px", border: "1px solid", flexShrink: 0 },
  editHint: { display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#334155", opacity: 0, transition: "opacity 0.2s", marginLeft: "auto" },
  editHintVisible: { opacity: 1, color: "#818cf8" },
  body: { display: "flex", flexDirection: "column", gap: 4 },
  line: { display: "flex", alignItems: "flex-start", gap: 7 },
  bullet: { width: 4, height: 4, borderRadius: "50%", background: "#4f46e5", flexShrink: 0, marginTop: 7 },
  lineText: { color: "#94a3b8", fontSize: 12, lineHeight: 1.6 },
  more: { fontSize: 11, color: "#475569", marginTop: 2 },
  empty: { fontSize: 12, color: "#334155", fontStyle: "italic" },
};

const as = {
  row: { display: "flex", alignItems: "flex-start", gap: 12 },
  card: { flex: 1, background: "rgba(15,23,42,0.7)", border: "1px solid rgba(99,102,241,0.12)", borderRadius: 14, padding: "16px 20px" },
  title: { fontSize: 10, color: "#64748b", marginBottom: 14, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" },
  steps: { display: "flex", flexDirection: "column", gap: 10 },
  stepRow: { display: "flex", alignItems: "center", gap: 12 },
  dot: { width: 26, height: 26, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  dotDone: { background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)", color: "#34d399" },
  dotActive: { background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.5)", color: "#818cf8" },
  dotPending: { background: "rgba(30,41,59,0.5)", border: "1px solid rgba(51,65,85,0.4)", color: "#334155" },
  dotNum: { fontSize: 11, color: "#475569" },
  spinnerDot: { width: 12, height: 12, border: "2px solid rgba(99,102,241,0.3)", borderTop: "2px solid #818cf8", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" },
  stepContent: { display: "flex", alignItems: "center", gap: 8 },
  stepLabel: { fontSize: 13 },
  labelDone: { color: "#64748b" }, labelActive: { color: "#e2e8f0", fontWeight: 500 }, labelPending: { color: "#334155" },
  activePill: { fontSize: 10, fontWeight: 700, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", borderRadius: 20, padding: "2px 8px" },
  donePill: { fontSize: 10, fontWeight: 700, background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399", borderRadius: 20, padding: "2px 8px" },
};

const pq = {
  box: { marginTop: 14, background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.18)", borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
  boxLeft: { display: "flex", alignItems: "center", gap: 12 },
  pptIcon: { width: 40, height: 40, borderRadius: 10, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  question: { color: "#e2e8f0", fontWeight: 600, fontSize: 13, marginBottom: 2 },
  sub: { color: "#64748b", fontSize: 12, lineHeight: 1.5 },
  actions: { display: "flex", gap: 8 },
  yesBtn: { background: "linear-gradient(135deg, #4f46e5, #7c3aed)", border: "none", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 600, padding: "8px 16px", cursor: "pointer", boxShadow: "0 4px 14px rgba(99,102,241,0.3)" },
  noBtn: { background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 9, color: "#64748b", fontSize: 13, padding: "8px 14px", cursor: "pointer" },
  loadingBox: { marginTop: 12, display: "flex", alignItems: "center", gap: 10, color: "#94a3b8", fontSize: 13 },
  loadingText: { color: "#94a3b8", fontSize: 13 },
  downloadBox: { marginTop: 12, background: "rgba(52,211,153,0.05)", border: "1px solid rgba(52,211,153,0.18)", borderRadius: 14, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 },
  downloadLeft: { display: "flex", alignItems: "center", gap: 12 },
  dlIconWrap: { width: 38, height: 38, borderRadius: 10, background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  downloadTitle: { color: "#e2e8f0", fontWeight: 600, fontSize: 13, marginBottom: 2 },
  downloadSub: { color: "#64748b", fontSize: 12 },
  downloadActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  previewBtn: { display: "flex", alignItems: "center", gap: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.22)", borderRadius: 9, color: "#818cf8", fontSize: 13, fontWeight: 600, padding: "8px 14px", cursor: "pointer" },
  btnOff: { opacity: 0.5, cursor: "not-allowed" },
  downloadBtn: { display: "flex", alignItems: "center", gap: 6, background: "linear-gradient(135deg, #059669, #10b981)", border: "none", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 600, padding: "8px 16px", cursor: "pointer", textDecoration: "none", boxShadow: "0 4px 14px rgba(16,185,129,0.3)" },
};
