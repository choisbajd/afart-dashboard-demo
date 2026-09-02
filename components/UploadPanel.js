import { useState } from "react";

// 관리자가 증분 CSV를 직접 올려서 반영하는 패널. 파일을 브라우저에서 읽어 텍스트로
// 서버에 보내고, 서버가 기존 데이터에 병합해 Vercel Blob에 저장한다.
export default function UploadPanel() {
  const [secret, setSecret] = useState("");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [status, setStatus] = useState(null); // { type: "ok" | "error", message }
  const [loading, setLoading] = useState(false);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStatus(null);
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!csvText) {
      setStatus({ type: "error", message: "먼저 CSV 파일을 선택해주세요." });
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/upload-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret, csvText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ type: "error", message: data.error || `업로드 실패 (${res.status})` });
      } else {
        const { updated, added, totalCount, ambiguousKeys } = data.stats;
        let message = `반영 완료 — 갱신 ${updated}건, 추가 ${added}건, 전체 ${totalCount}건`;
        if (ambiguousKeys?.length > 0) {
          message += ` (⚠ 자동 치환 못한 중복 키 ${ambiguousKeys.length}건, 수기 확인 필요)`;
        }
        setStatus({ type: "ok", message });
        setCsvText("");
        setFileName("");
      }
    } catch (err) {
      setStatus({ type: "error", message: `요청 실패: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section">
      <div className="section-head">
        <h2>매출 데이터 업로드 (관리자)</h2>
      </div>
      <p className="section-note">
        Snowflake에서 뽑은 증분 CSV를 여기서 바로 올리면, 기존 데이터에 병합돼서 반영됩니다.
        (Vercel Blob이 연결되어 있어야 실제로 저장됩니다 — 연결 전이면 에러가 표시됩니다.)
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input type="file" accept=".csv" onChange={handleFile} />
        <input
          type="password"
          className="date-input"
          placeholder="업로드 비밀번호"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          style={{ width: 160 }}
        />
        <button type="button" className="btn-primary" onClick={handleUpload} disabled={loading}>
          {loading ? "반영 중…" : "반영하기"}
        </button>
        {fileName && <span style={{ fontSize: 12.5, color: "var(--ink-muted)" }}>{fileName}</span>}
      </div>
      {status && (
        <p
          className="section-note"
          style={{ marginTop: 10, color: status.type === "ok" ? "var(--good)" : "var(--bad, #a8442f)" }}
        >
          {status.message}
        </p>
      )}
    </section>
  );
}
