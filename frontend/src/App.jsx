import React, { useState, useEffect } from "react";
import UploadTemplate from "./UploadTemplate";
import ChatWindow from "./ChatWindow";

const API = "http://localhost:8000";

export default function App() {
  const [sessionId, setSessionId] = useState(null);
  const [templateReady, setTemplateReady] = useState(false);
  const [slideStructure, setSlideStructure] = useState("");
  const [slideCount, setSlideCount] = useState(0);

  useEffect(() => {
    const stored = localStorage.getItem("ppt_session_id");
    if (stored) {
      setSessionId(stored);
    } else {
      fetch(`${API}/new-session`)
        .then((r) => r.json())
        .then((data) => {
          setSessionId(data.session_id);
          localStorage.setItem("ppt_session_id", data.session_id);
        });
    }
  }, []);

  return (
    <div style={s.root}>
      {/* Ambient glows */}
      <div style={s.glow1} />
      <div style={s.glow2} />

      <div style={s.layout}>
        {/* ── Sidebar ── */}
        <aside style={s.sidebar} className="sidebar">
          <div style={s.brand}>
            <div style={s.brandIcon}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span style={s.brandName}>SlideAI</span>
          </div>

          <div style={s.sideSection}>
            <p style={s.sideLabel}>WORKSPACE</p>

            <div style={{ ...s.sideItem, ...(templateReady ? s.sideItemDone : s.sideItemActive) }}>
              <span style={{ ...s.sideStep, ...(templateReady ? s.sideStepDone : s.sideStepActive) }}>
                {templateReady ? "✓" : "1"}
              </span>
              <div>
                <p style={s.sideItemTitle}>PPT Template</p>
                <p style={s.sideItemSub}>
                  {templateReady ? `${slideCount} slides loaded` : "Upload your .pptx file"}
                </p>
              </div>
            </div>

            <div style={s.sideDivider} />

            <div style={{ ...s.sideItem, ...(templateReady ? s.sideItemActive : {}) }}>
              <span style={{ ...s.sideStep, ...(templateReady ? s.sideStepActive : s.sideStepInactive) }}>
                2
              </span>
              <div>
                <p style={s.sideItemTitle}>Map Content</p>
                <p style={s.sideItemSub}>
                  {templateReady ? "Paste raw data to begin" : "Upload template first"}
                </p>
              </div>
            </div>
          </div>

          {templateReady && (
            <div style={s.sideFooter}>
              <button onClick={() => setTemplateReady(false)} style={s.changeBtn}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M3 12a9 9 0 109-9 9 9 0 00-9 9M3 3v6h6"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Change Template
              </button>
            </div>
          )}

          <div style={s.sideBottom}>
            <div style={s.sessionBadge}>
              <span style={s.sessionDot} />
              <span style={s.sessionText}>Session active</span>
            </div>
          </div>
        </aside>

        {/* ── Main panel ── */}
        <main style={s.main} className="main-panel">
          {!templateReady ? (
            <div style={s.uploadWrap}>
              <UploadTemplate
                sessionId={sessionId}
                apiBase={API}
                onSuccess={(structure, count) => {
                  setSlideStructure(structure);
                  setSlideCount(count);
                  setTemplateReady(true);
                }}
              />
            </div>
          ) : (
            <ChatWindow
              sessionId={sessionId}
              apiBase={API}
              slideStructure={slideStructure}
              onReset={() => setTemplateReady(false)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

const s = {
  root: {
    height: "100%",
    background: "#020817",
    position: "relative",
    overflow: "hidden",
  },
  glow1: {
    position: "fixed", top: -300, left: -200,
    width: 700, height: 700, borderRadius: "50%",
    background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  glow2: {
    position: "fixed", bottom: -300, right: -200,
    width: 700, height: 700, borderRadius: "50%",
    background: "radial-gradient(circle, rgba(139,92,246,0.1) 0%, transparent 70%)",
    pointerEvents: "none",
  },
  layout: {
    display: "flex",
    height: "100%",
    position: "relative",
    zIndex: 1,
  },

  // Sidebar
  sidebar: {
    width: 260,
    flexShrink: 0,
    background: "rgba(10,15,30,0.95)",
    borderRight: "1px solid rgba(99,102,241,0.1)",
    display: "flex",
    flexDirection: "column",
    padding: "24px 16px",
    backdropFilter: "blur(20px)",
  },
  brand: {
    display: "flex", alignItems: "center", gap: 10,
    marginBottom: 36,
    paddingLeft: 4,
  },
  brandIcon: {
    width: 36, height: 36, borderRadius: 10,
    background: "linear-gradient(135deg, #1e1b4b, #312e81)",
    border: "1px solid rgba(99,102,241,0.35)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 16px rgba(99,102,241,0.25)",
  },
  brandName: {
    fontSize: 20, fontWeight: 700,
    background: "linear-gradient(135deg, #818cf8, #c084fc)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  sideSection: { flex: 1 },
  sideLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
    color: "#334155", marginBottom: 14, paddingLeft: 4,
  },
  sideItem: {
    display: "flex", alignItems: "flex-start", gap: 12,
    padding: "10px 8px", borderRadius: 10,
    transition: "background 0.2s",
  },
  sideItemActive: { background: "rgba(99,102,241,0.06)" },
  sideItemDone: { background: "rgba(52,211,153,0.04)" },
  sideStep: {
    width: 26, height: 26, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 700, flexShrink: 0,
  },
  sideStepActive: {
    background: "rgba(99,102,241,0.15)",
    border: "1px solid rgba(99,102,241,0.4)",
    color: "#818cf8",
  },
  sideStepDone: {
    background: "rgba(52,211,153,0.15)",
    border: "1px solid rgba(52,211,153,0.4)",
    color: "#34d399",
  },
  sideStepInactive: {
    background: "rgba(30,41,59,0.5)",
    border: "1px solid rgba(51,65,85,0.5)",
    color: "#475569",
  },
  sideItemTitle: { fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 2 },
  sideItemSub: { fontSize: 11, color: "#475569" },
  sideDivider: {
    height: 1, background: "rgba(99,102,241,0.08)",
    margin: "8px 0",
  },
  sideFooter: { marginBottom: 16 },
  changeBtn: {
    display: "flex", alignItems: "center", gap: 6,
    width: "100%", padding: "9px 12px",
    background: "rgba(99,102,241,0.08)",
    border: "1px solid rgba(99,102,241,0.15)",
    borderRadius: 10, color: "#818cf8",
    fontSize: 12, fontWeight: 500, cursor: "pointer",
  },
  sideBottom: { marginTop: "auto", paddingTop: 16 },
  sessionBadge: {
    display: "flex", alignItems: "center", gap: 7,
    padding: "8px 12px",
    background: "rgba(52,211,153,0.06)",
    border: "1px solid rgba(52,211,153,0.15)",
    borderRadius: 8,
  },
  sessionDot: {
    width: 7, height: 7, borderRadius: "50%",
    background: "#34d399",
    boxShadow: "0 0 6px rgba(52,211,153,0.7)",
    flexShrink: 0,
  },
  sessionText: { fontSize: 11, color: "#34d399", fontWeight: 500 },

  // Main
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "rgba(2,8,23,0.6)",
  },
  uploadWrap: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 60px",
    overflowY: "auto",
  },
};
