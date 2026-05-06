import React, { useState, useRef } from "react";
import axios from "axios";

export default function UploadTemplate({ sessionId, apiBase, onSuccess }) {
  const [file, setFile]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef();

  const handleFile = (f) => {
    if (f && f.name.endsWith(".pptx")) { setFile(f); setError(""); }
    else setError("Only .pptx files are supported");
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true); setError("");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("session_id", sessionId);
    try {
      const res = await axios.post(`${apiBase}/upload-template`, fd);
      onSuccess(res.data.slide_structure, res.data.slides_detected);
    } catch (err) {
      setError(err.response?.data?.detail || "Upload failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      {/* Hero */}
      <div style={s.hero}>
        <div style={s.heroIcon}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
              stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <h1 style={s.heroTitle}>SlideAI</h1>
        <p style={s.heroSub}>Upload your PowerPoint template and let AI fill it with your content — instantly.</p>
      </div>

      {/* Features row */}
      <div style={s.features}>
        {[
          { icon: "⚡", label: "Instant mapping" },
          { icon: "🎨", label: "Preserves your design" },
          { icon: "✏️", label: "Per-slide editing" },
        ].map((f) => (
          <div key={f.label} style={s.featureChip}>
            <span>{f.icon}</span>
            <span style={s.featureLabel}>{f.label}</span>
          </div>
        ))}
      </div>

      {/* Upload card */}
      <div style={s.card}>
        <div style={s.cardTopLine} />

        <h2 style={s.cardTitle}>Upload your PPT template</h2>
        <p style={s.cardSub}>We'll analyse the slide structure and map your content to the right slides.</p>

        {/* Drop zone */}
        <div
          style={{
            ...s.dropzone,
            ...(dragging ? s.dropzoneDrag : {}),
            ...(file    ? s.dropzoneReady : {}),
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current.click()}
        >
          <input ref={inputRef} type="file" accept=".pptx" style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files[0])} />

          {file ? (
            <div style={s.fileRow}>
              <div style={s.fileIconWrap}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
                    stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"
                    stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </div>
              <div style={s.fileDetails}>
                <p style={s.fileName}>{file.name}</p>
                <p style={s.fileSize}>{(file.size / 1024).toFixed(1)} KB · Ready to upload</p>
              </div>
              <div style={s.fileCheck}>✓</div>
            </div>
          ) : (
            <div style={s.dropContent}>
              <div style={s.uploadIconWrap}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"
                    stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p style={s.dropText}>
                Drop your <strong style={{ color: "#818cf8" }}>.pptx</strong> here or{" "}
                <span style={s.browseLink}>browse files</span>
              </p>
              <p style={s.dropHint}>PowerPoint files only · Max 50 MB</p>
            </div>
          )}
        </div>

        {error && (
          <div style={s.errorBox}>⚠ {error}</div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || loading}
          style={{ ...s.btn, ...(!file || loading ? s.btnOff : {}) }}
        >
          {loading ? (
            <><span style={s.spinner} /> Analysing slides…</>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Analyse Template
            </>
          )}
        </button>

        <p style={s.hint}>Your template design is never modified — we only read its structure.</p>
      </div>
    </div>
  );
}

const s = {
  page: {
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "48px 24px", gap: 28, width: "100%", maxWidth: 560, margin: "0 auto",
  },

  // Hero
  hero: { textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  heroIcon: {
    width: 64, height: 64, borderRadius: 18,
    background: "linear-gradient(135deg, rgba(79,70,229,0.2), rgba(124,58,237,0.2))",
    border: "1px solid rgba(99,102,241,0.3)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 40px rgba(99,102,241,0.2)",
  },
  heroTitle: {
    fontSize: 32, fontWeight: 800,
    background: "linear-gradient(135deg, #818cf8, #c084fc)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  heroSub: { fontSize: 15, color: "#64748b", maxWidth: 380, lineHeight: 1.7 },

  // Features
  features: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" },
  featureChip: {
    display: "flex", alignItems: "center", gap: 6,
    background: "rgba(99,102,241,0.07)",
    border: "1px solid rgba(99,102,241,0.15)",
    borderRadius: 20, padding: "6px 14px",
  },
  featureLabel: { fontSize: 12, color: "#94a3b8", fontWeight: 500 },

  // Card
  card: {
    position: "relative", width: "100%",
    background: "linear-gradient(160deg, rgba(15,23,42,0.95), rgba(10,15,30,0.9))",
    border: "1px solid rgba(99,102,241,0.18)",
    borderRadius: 20, padding: "36px 32px",
    backdropFilter: "blur(20px)",
    display: "flex", flexDirection: "column", gap: 16,
  },
  cardTopLine: {
    position: "absolute", top: 0, left: "10%", right: "10%", height: 1,
    background: "linear-gradient(90deg, transparent, rgba(99,102,241,0.5), transparent)",
  },
  cardTitle: { fontSize: 18, fontWeight: 700, color: "#f1f5f9" },
  cardSub: { fontSize: 13, color: "#64748b", lineHeight: 1.6, marginTop: -8 },

  // Drop zone
  dropzone: {
    border: "2px dashed rgba(99,102,241,0.22)",
    borderRadius: 14, padding: "32px 20px",
    textAlign: "center", cursor: "pointer",
    transition: "all 0.2s",
    background: "rgba(99,102,241,0.02)",
  },
  dropzoneDrag: {
    border: "2px dashed rgba(99,102,241,0.55)",
    background: "rgba(99,102,241,0.07)",
  },
  dropzoneReady: {
    border: "2px dashed rgba(52,211,153,0.4)",
    background: "rgba(52,211,153,0.03)",
  },
  dropContent: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
  uploadIconWrap: {
    width: 52, height: 52, borderRadius: 14,
    background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  dropText: { color: "#94a3b8", fontSize: 14 },
  browseLink: { color: "#818cf8", textDecoration: "underline", cursor: "pointer" },
  dropHint: { color: "#475569", fontSize: 12 },

  // File selected
  fileRow: { display: "flex", alignItems: "center", gap: 14, textAlign: "left" },
  fileIconWrap: {
    width: 44, height: 44, borderRadius: 10,
    background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  fileDetails: { flex: 1, minWidth: 0 },
  fileName: { color: "#e2e8f0", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  fileSize: { color: "#64748b", fontSize: 12, marginTop: 2 },
  fileCheck: {
    width: 28, height: 28, borderRadius: "50%",
    background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.4)",
    color: "#34d399", display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, fontWeight: 700, flexShrink: 0,
  },

  // Error
  errorBox: {
    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13,
  },

  // Button
  btn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: "14px", background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    border: "none", borderRadius: 12, color: "#fff",
    fontSize: 15, fontWeight: 600, cursor: "pointer",
    boxShadow: "0 4px 20px rgba(99,102,241,0.35)",
    transition: "opacity 0.2s",
  },
  btnOff: { opacity: 0.4, cursor: "not-allowed", boxShadow: "none" },
  spinner: {
    width: 14, height: 14,
    border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid #fff",
    borderRadius: "50%", display: "inline-block",
    animation: "spin 0.8s linear infinite",
  },
  hint: { fontSize: 11, color: "#334155", textAlign: "center" },
};
