import React, { useState } from "react";

export default function PPTPreview({ slides, apiBase, onClose }) {
  const [current, setCurrent] = useState(0);
  const total = slides.length;

  const prev = () => setCurrent((c) => Math.max(0, c - 1));
  const next = () => setCurrent((c) => Math.min(total - 1, c + 1));

  const handleKey = (e) => {
    if (e.key === "ArrowLeft")  prev();
    if (e.key === "ArrowRight") next();
    if (e.key === "Escape")     onClose();
  };

  return (
    <div style={s.overlay} onKeyDown={handleKey} tabIndex={0} autoFocus>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.headerIcon}>📊</div>
          <div>
            <p style={s.headerTitle}>Slide Preview</p>
            <p style={s.headerSub}>Slide {current + 1} of {total}</p>
          </div>
        </div>
        <button onClick={onClose} style={s.closeBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <div style={s.body}>
        {/* Thumbnail sidebar */}
        <div style={s.sidebar}>
          <p style={s.sideLabel}>SLIDES</p>
          <div style={s.thumbList}>
            {slides.map((url, i) => (
              <div
                key={i}
                onClick={() => setCurrent(i)}
                style={{ ...s.thumb, ...(i === current ? s.thumbActive : {}) }}
              >
                <img
                  src={`${apiBase}${url}`}
                  alt={`Slide ${i + 1}`}
                  style={s.thumbImg}
                />
                <span style={{ ...s.thumbNum, ...(i === current ? s.thumbNumActive : {}) }}>
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Main slide view */}
        <div style={s.main}>
          <div style={s.slideWrap}>
            <img
              key={current}
              src={`${apiBase}${slides[current]}`}
              alt={`Slide ${current + 1}`}
              style={s.slideImg}
            />
          </div>

          {/* Navigation */}
          <div style={s.nav}>
            <button onClick={prev} disabled={current === 0} style={{ ...s.navBtn, ...(current === 0 ? s.navBtnOff : {}) }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Prev
            </button>

            {/* Dot indicators */}
            <div style={s.dots}>
              {slides.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrent(i)}
                  style={{ ...s.dot, ...(i === current ? s.dotActive : {}) }}
                />
              ))}
            </div>

            <button onClick={next} disabled={current === total - 1} style={{ ...s.navBtn, ...(current === total - 1 ? s.navBtnOff : {}) }}>
              Next
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <p style={s.keyHint}>← → arrow keys to navigate · Esc to close</p>
        </div>
      </div>
    </div>
  );
}

const s = {
  overlay: {
    position: "fixed", inset: 0,
    background: "rgba(2,8,23,0.97)",
    backdropFilter: "blur(12px)",
    zIndex: 2000,
    display: "flex", flexDirection: "column",
    animation: "fadeIn 0.2s ease",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 28px",
    borderBottom: "1px solid rgba(99,102,241,0.15)",
    background: "rgba(10,15,30,0.8)",
    flexShrink: 0,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerIcon: {
    width: 40, height: 40, borderRadius: 10,
    background: "rgba(99,102,241,0.1)",
    border: "1px solid rgba(99,102,241,0.2)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 20,
  },
  headerTitle: { color: "#f1f5f9", fontWeight: 700, fontSize: 16 },
  headerSub: { color: "#475569", fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 36, height: 36, borderRadius: 8,
    background: "rgba(99,102,241,0.08)",
    border: "1px solid rgba(99,102,241,0.15)",
    color: "#64748b", display: "flex",
    alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },
  body: {
    flex: 1, display: "flex", overflow: "hidden",
  },

  // Thumbnail sidebar
  sidebar: {
    width: 180, flexShrink: 0,
    background: "rgba(10,15,30,0.6)",
    borderRight: "1px solid rgba(99,102,241,0.1)",
    overflowY: "auto",
    padding: "16px 12px",
  },
  sideLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
    color: "#334155", marginBottom: 12, paddingLeft: 4,
  },
  thumbList: { display: "flex", flexDirection: "column", gap: 8 },
  thumb: {
    position: "relative",
    borderRadius: 8,
    overflow: "hidden",
    border: "2px solid transparent",
    cursor: "pointer",
    transition: "border-color 0.15s",
    background: "#0f172a",
  },
  thumbActive: {
    border: "2px solid #818cf8",
    boxShadow: "0 0 12px rgba(99,102,241,0.3)",
  },
  thumbImg: { width: "100%", display: "block", aspectRatio: "16/9", objectFit: "cover" },
  thumbNum: {
    position: "absolute", bottom: 4, right: 6,
    fontSize: 10, fontWeight: 700, color: "#475569",
  },
  thumbNumActive: { color: "#818cf8" },

  // Main view
  main: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "32px 40px", gap: 24, overflow: "hidden",
  },
  slideWrap: {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    width: "100%", maxHeight: "calc(100vh - 260px)",
  },
  slideImg: {
    maxWidth: "100%", maxHeight: "100%",
    borderRadius: 12,
    boxShadow: "0 24px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15)",
    objectFit: "contain",
    animation: "fadeIn 0.2s ease",
  },
  nav: {
    display: "flex", alignItems: "center", gap: 20,
    flexShrink: 0,
  },
  navBtn: {
    display: "flex", alignItems: "center", gap: 6,
    background: "rgba(99,102,241,0.1)",
    border: "1px solid rgba(99,102,241,0.2)",
    borderRadius: 10, color: "#818cf8",
    fontSize: 13, fontWeight: 600,
    padding: "9px 18px", cursor: "pointer",
    transition: "opacity 0.15s",
  },
  navBtnOff: { opacity: 0.3, cursor: "not-allowed" },
  dots: { display: "flex", gap: 6 },
  dot: {
    width: 7, height: 7, borderRadius: "50%",
    background: "#1e293b", border: "1px solid #334155",
    cursor: "pointer", padding: 0, transition: "all 0.15s",
  },
  dotActive: {
    background: "#818cf8",
    border: "1px solid #818cf8",
    boxShadow: "0 0 8px rgba(129,140,248,0.5)",
  },
  keyHint: { fontSize: 11, color: "#1e293b" },
};
