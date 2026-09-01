/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // snowflake-sdk는 외부 스테이지(S3/Azure/GCS) 업로드 기능 때문에 각 클라우드 SDK를
  // 통째로 끌고 온다. 우리는 SELECT 쿼리만 쓰므로 그 부분은 실행되지 않는데도
  // Vercel 서버리스 함수 번들에 같이 딸려 들어가 배포 용량 제한을 넘길 수 있어 제외한다.
  experimental: {
    outputFileTracingExcludes: {
      "/api/cron/sync": [
        "node_modules/@aws-sdk/**",
        "node_modules/aws-sdk/**",
        "node_modules/@azure/**",
        "node_modules/@google-cloud/**",
      ],
    },
  },
  // 사내 데이터가 담긴 데모라 검색엔진 색인을 전부 막는다 (robots.txt + 메타태그와 이중 방어).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

module.exports = nextConfig;
