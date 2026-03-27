/** @type {import('next').NextConfig} */
const nextConfig = {
  // React Strict Mode 활성화 (개발 시 잠재적 문제 감지)
  reactStrictMode: true,

  // 실험적 기능
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  // node-cron, pdf-parse 등 서버 전용 패키지
  serverExternalPackages: ['node-cron', 'pdf-parse', 'youtubei.js', 'oracledb', 'pg', 'mysql2'],

  // 이미지 최적화 설정
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },

  // 출력 설정 (Docker standalone 빌드용)
  output: 'standalone',
};

module.exports = nextConfig;
