import { useState } from "react";
import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { signIn } from "next-auth/react";
import { authOptions } from "../lib/authOptions";

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (session) {
    return { redirect: { destination: "/", permanent: false } };
  }
  return { props: {} };
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", { username, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      setError("아이디 또는 비밀번호가 올바르지 않습니다.");
      return;
    }
    window.location.href = "/";
  };

  return (
    <>
      <Head>
        <title>로그인 · 다이렉트 대시보드 for AFART</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
      </Head>
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg)",
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            width: 320,
            background: "#fff",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "32px 28px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--accent-ink)", marginBottom: 4 }}>
            다이렉트 대시보드
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-muted)", marginBottom: 22 }}>for AFART · 관리자 로그인</div>

          <label style={{ display: "block", fontSize: 13, color: "var(--ink-muted)", marginBottom: 4 }}>
            아이디
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            style={{
              width: "100%",
              padding: "9px 10px",
              marginBottom: 14,
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              fontSize: 14,
            }}
          />

          <label style={{ display: "block", fontSize: 13, color: "var(--ink-muted)", marginBottom: 4 }}>
            비밀번호
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            style={{
              width: "100%",
              padding: "9px 10px",
              marginBottom: 18,
              border: "1px solid var(--border-strong)",
              borderRadius: 6,
              fontSize: 14,
            }}
          />

          {error && (
            <div style={{ fontSize: 13, color: "#c0392b", marginBottom: 14 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "10px 0",
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </>
  );
}
