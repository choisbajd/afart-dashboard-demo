import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

// 지금은 관리자 계정 1개만 쓰는 내부 도구라 아이디/비번을 환경변수에 넣어두고 비교한다.
// 비밀번호는 평문이 아니라 bcrypt 해시(ADMIN_PASSWORD_HASH_B64)로 저장 — 유출돼도 원문이 바로 드러나지 않는다.
// bcrypt 해시는 "$2b$10$..." 처럼 $를 포함하는데, .env 파일은 $VAR 형태를 변수 치환으로 해석해서
// 저장하면 해시가 깨진다 — 그래서 base64로 한 번 감싸서 저장하고 여기서 다시 풀어 쓴다.
// 나중에 구글 로그인(Workspace 계정)을 추가할 때는 providers 배열에 GoogleProvider를 더 넣으면 된다.
export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "아이디/비밀번호",
      credentials: {
        username: { label: "아이디", type: "text" },
        password: { label: "비밀번호", type: "password" },
      },
      async authorize(credentials) {
        const { ADMIN_USERNAME, ADMIN_PASSWORD_HASH_B64 } = process.env;
        if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH_B64) {
          throw new Error(
            "관리자 계정이 설정되지 않았습니다 (ADMIN_USERNAME / ADMIN_PASSWORD_HASH_B64)."
          );
        }
        if (!credentials?.username || !credentials?.password) return null;
        if (credentials.username !== ADMIN_USERNAME) return null;

        const passwordHash = Buffer.from(ADMIN_PASSWORD_HASH_B64, "base64").toString("utf8");
        const ok = await bcrypt.compare(credentials.password, passwordHash);
        if (!ok) return null;

        return { id: "admin", name: "관리자", role: "ADMIN" };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.role = user.role;
      return token;
    },
    async session({ session, token }) {
      if (session.user) session.user.role = token.role;
      return session;
    },
  },
};
