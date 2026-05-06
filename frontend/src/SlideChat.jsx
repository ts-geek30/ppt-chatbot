import React, { useState, useEffect, useRef } from "react";

export default function SlideChat({ slide, history, sessionId, apiBase, onApply, onClose, onHistoryUpdate }) {
  const [messages, setMessages] = useState(history ?? []);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [latestRefined, setLatestRefined] = useState(null);
  const bottomRef = useRef();

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Notify parent of history changes so it can preserve them (req 6.4)
  useEffect(() => {
    if (onHistoryUpdate) onHistoryUpdate(messages);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Attach Escape key listener (req 6.3)
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;

    const instruction = input.trim();
    // Capture history BEFORE appending the new user message (req 4.3)
    const historyToSend = [...messages];

    // Append user message immediately (req 2.2)
    setMessages((prev) => [...prev, { role: "user", content: instruction }]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/refine-slide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          slide_number: slide.slide_number,
          slide_title: slide.slide_title,
          current_content: slide.suggested_content,
          instruction,
          chat_history: historyToSend,  // prior turns only, not the in-flight message
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Unknown error" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const refined = data.refined_content;

      // Append AI response (req 2.5)
      setMessages((prev) => [...prev, { role: "assistant", content: refined }]);
      setLatestRefined(refined);  // activates Apply button (req 5.1)
    } catch (e) {
      // Show error inline, re-enable input (req 2.7)
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleApply = () => {
    if (latestRefined) {
      onApply(slide.slide_number, latestRefined);
    }
  };

  return (
    // Fixed overlay — keeps main view visible beneath (req 1.5)
    <div style={sc.overlay} onClick={onClose}>
      <div style={sc.modal} onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div style={sc.header}>
          <div style={sc.headerLeft}>
            <div style={sc.headerTopRow}>
              <span style={sc.badge}>Slide {slide.slide_number}</span>
              <span style={sc.headerTitle}>{slide.slide_title}</span>
            </div>
            <p style={sc.headerLabel}>CURRENT CONTENT</p>
            {/* Read-only slide context (req 1.2, 1.3) */}
            <div style={sc.contextBox}>
              <p style={sc.contextText}>{slide.suggested_content}</p>
            </div>
          </div>
          <button onClick={onClose} style={sc.closeIconBtn} title="Close (Esc)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* ── Message list (req 2.1, 2.2, 2.5) ── */}
        <div style={sc.messageList}>
          {messages.length === 0 && !loading && (
            <div style={sc.emptyState}>
              <p style={sc.emptyTitle}>Refine this slide</p>
              <p style={sc.emptySub}>
                Type an instruction below — e.g. "make this more concise", "rewrite for a technical audience", or "add a statistic here".
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={msg.role === "user" ? sc.userMsgRow : sc.aiMsgRow}>
              {msg.role === "assistant" && (
                <div style={sc.aiAvatar}>AI</div>
              )}
              <div style={msg.role === "user" ? sc.userBubble : sc.aiBubble}>
                <p style={msg.role === "user" ? sc.userText : sc.aiText}>{msg.content}</p>
              </div>
              {msg.role === "user" && (
                <div style={sc.userAvatar}>You</div>
              )}
            </div>
          ))}

          {/* Inline loading indicator (req 2.6) */}
          {loading && (
            <div style={sc.aiMsgRow}>
              <div style={sc.aiAvatar}>AI</div>
              <div style={sc.aiBubble}>
                <div style={sc.loadingDots}>
                  <span style={sc.dot1} />
                  <span style={sc.dot2} />
                  <span style={sc.dot3} />
                </div>
              </div>
            </div>
          )}

          {/* Inline error message (req 2.7) */}
          {error && (
            <div style={sc.errorBox}>
              <span style={sc.errorIcon}>⚠</span>
              <span style={sc.errorText}>{error}</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input area (req 2.1, 2.6) ── */}
        <div style={sc.inputArea}>
          <div style={sc.inputWrap}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              placeholder="Type a refinement instruction… (Enter to send)"
              style={{ ...sc.textarea, ...(loading ? sc.textareaDisabled : {}) }}
              rows={2}
            />
            <div style={sc.inputActions}>
              <span style={sc.inputHint}>Enter to send · Shift+Enter for new line</span>
              <button
                onClick={handleSubmit}
                disabled={loading || !input.trim()}
                style={{ ...sc.sendBtn, ...(loading || !input.trim() ? sc.sendBtnOff : {}) }}
              >
                {loading
                  ? <><span style={sc.spinner} /><span>Refining…</span></>
                  : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg><span>Send</span></>
                }
              </button>
            </div>
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div style={sc.footer}>
          {/* Close button — always visible (req 6.1) */}
          <button onClick={onClose} style={sc.footerCloseBtn}>
            Close
          </button>

          {/* Apply button — active only when latestRefined is set (req 5.1) */}
          <button
            onClick={handleApply}
            disabled={!latestRefined}
            style={{ ...sc.applyBtn, ...(!latestRefined ? sc.applyBtnOff : {}) }}
            title={latestRefined ? "Apply refined content to slide" : "Send a message first to get a refined version"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Apply to Slide
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────
const sc = {
  // Full-screen fixed overlay (req 1.5)
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,8,23,0.75)",
    backdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 20,
    animation: "fadeIn 0.2s ease",
  },
  modal: {
    background: "linear-gradient(135deg, #0f172a, #0a0f1e)",
    border: "1px solid rgba(99,102,241,0.25)",
    borderRadius: 20,
    width: "100%",
    maxWidth: 640,
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
    overflow: "hidden",
  },

  // Header
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    padding: "22px 26px 18px",
    borderBottom: "1px solid rgba(99,102,241,0.1)",
    background: "rgba(99,102,241,0.04)",
    flexShrink: 0,
    gap: 12,
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  headerTopRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  badge: {
    display: "inline-block",
    background: "rgba(99,102,241,0.15)",
    border: "1px solid rgba(99,102,241,0.3)",
    color: "#818cf8",
    borderRadius: 8,
    padding: "3px 10px",
    fontSize: 11,
    fontWeight: 700,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: "#f1f5f9",
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "#475569",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  contextBox: {
    background: "rgba(99,102,241,0.05)",
    border: "1px solid rgba(99,102,241,0.12)",
    borderRadius: 10,
    padding: "12px 14px",
  },
  contextText: {
    color: "#94a3b8",
    fontSize: 13,
    lineHeight: 1.65,
  },
  closeIconBtn: {
    background: "rgba(99,102,241,0.08)",
    border: "1px solid rgba(99,102,241,0.15)",
    borderRadius: 8,
    color: "#64748b",
    width: 32,
    height: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },

  // Message list
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },

  // Empty state
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "32px 20px",
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: "#cbd5e1",
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 1.7,
    maxWidth: 380,
  },

  // User message
  userMsgRow: {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "flex-end",
    gap: 8,
  },
  userBubble: {
    maxWidth: "70%",
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    borderRadius: "16px 16px 4px 16px",
    padding: "11px 16px",
    boxShadow: "0 4px 16px rgba(99,102,241,0.25)",
  },
  userText: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  userAvatar: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 700,
    color: "#fff",
    flexShrink: 0,
  },

  // AI message
  aiMsgRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
  },
  aiAvatar: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "rgba(15,23,42,0.9)",
    border: "1px solid rgba(99,102,241,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 700,
    color: "#818cf8",
    flexShrink: 0,
    boxShadow: "0 0 10px rgba(99,102,241,0.15)",
  },
  aiBubble: {
    maxWidth: "70%",
    background: "rgba(15,23,42,0.7)",
    border: "1px solid rgba(99,102,241,0.12)",
    borderRadius: "4px 16px 16px 16px",
    padding: "11px 16px",
  },
  aiText: {
    color: "#e2e8f0",
    fontSize: 14,
    lineHeight: 1.65,
    whiteSpace: "pre-wrap",
  },

  // Loading dots
  loadingDots: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "4px 0",
  },
  dot1: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#818cf8",
    display: "inline-block",
    animation: "bounce 1.2s ease-in-out 0s infinite",
  },
  dot2: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#818cf8",
    display: "inline-block",
    animation: "bounce 1.2s ease-in-out 0.2s infinite",
  },
  dot3: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#818cf8",
    display: "inline-block",
    animation: "bounce 1.2s ease-in-out 0.4s infinite",
  },

  // Error
  errorBox: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 10,
    padding: "12px 14px",
  },
  errorIcon: {
    fontSize: 14,
    flexShrink: 0,
    color: "#fca5a5",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 13,
    lineHeight: 1.5,
  },

  // Input area
  inputArea: {
    flexShrink: 0,
    padding: "12px 20px 16px",
    borderTop: "1px solid rgba(99,102,241,0.1)",
    background: "rgba(10,15,30,0.7)",
    backdropFilter: "blur(10px)",
  },
  inputWrap: {
    background: "rgba(15,23,42,0.9)",
    border: "1px solid rgba(99,102,241,0.2)",
    borderRadius: 14,
    overflow: "hidden",
  },
  textarea: {
    width: "100%",
    display: "block",
    background: "transparent",
    border: "none",
    padding: "14px 18px 8px",
    fontSize: 14,
    color: "#e2e8f0",
    resize: "none",
    fontFamily: "inherit",
    lineHeight: 1.6,
    outline: "none",
  },
  textareaDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  inputActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px 10px",
  },
  inputHint: {
    fontSize: 11,
    color: "#334155",
  },
  sendBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    border: "none",
    borderRadius: 9,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 16px",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(99,102,241,0.35)",
  },
  sendBtnOff: {
    opacity: 0.4,
    cursor: "not-allowed",
    boxShadow: "none",
  },
  spinner: {
    width: 12,
    height: 12,
    border: "2px solid rgba(255,255,255,0.3)",
    borderTop: "2px solid #fff",
    borderRadius: "50%",
    display: "inline-block",
    animation: "spin 0.8s linear infinite",
    marginRight: 4,
  },

  // Footer
  footer: {
    flexShrink: 0,
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    padding: "14px 24px 20px",
    borderTop: "1px solid rgba(99,102,241,0.08)",
  },
  footerCloseBtn: {
    background: "rgba(99,102,241,0.08)",
    border: "1px solid rgba(99,102,241,0.15)",
    borderRadius: 10,
    color: "#64748b",
    padding: "9px 20px",
    fontSize: 13,
    cursor: "pointer",
  },
  applyBtn: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    background: "linear-gradient(135deg, #059669, #10b981)",
    border: "none",
    borderRadius: 10,
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    padding: "9px 20px",
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(16,185,129,0.3)",
  },
  applyBtnOff: {
    opacity: 0.35,
    cursor: "not-allowed",
    boxShadow: "none",
  },
};
