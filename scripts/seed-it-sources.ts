/**
 * IT 관련 데이터 소스 시드 스크립트
 * YouTube 채널, RSS 피드, 뉴스, 웹사이트 등을 rag-collector에 일괄 등록
 *
 * 실행: npx tsx scripts/seed-it-sources.ts
 */

import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

interface SourceSeed {
  name: string;
  type: 'YOUTUBE_CHANNEL' | 'RSS_FEED' | 'WEB_CRAWL' | 'MOLTBOOK';
  url?: string;
  config: Record<string, unknown>;
  cronExpr: string;
  tags: string[];
}

const SOURCES: SourceSeed[] = [
  // =============================================
  // Moltbook
  // =============================================
  {
    name: 'Moltbook AI/Tech',
    type: 'MOLTBOOK',
    config: {
      submolts: ['ai', 'technology', 'agents', 'tooling', 'infrastructure', 'security'],
      maxResults: 25,
      translate: true,
    },
    cronExpr: '*/15 * * * *', // 15분마다
    tags: ['moltbook', 'ai', 'tech'],
  },

  // =============================================
  // YouTube 채널 — 한국
  // =============================================
  ...[
    { id: 'UCxj3eVTAv9KLdrowXcuCFDQ', name: '빌더 조쉬 Builder Josh' },
    { id: 'UCxZ2AlaT0hOmxzZVbF_j_Sw', name: '코드팩토리' },
    { id: 'UCXKXULkq--aSgzScYeLYJog', name: '단테랩스' },
    { id: 'UC4QaHaQJ3t8nYDOO7NiDfcA', name: 'Daniel Vision School Korea' },
    { id: 'UCUpkgT9Entggw2fMBprWM4w', name: '엔드플랜 Endplan AI' },
    { id: 'UCSJDgl6tVc08c5d6y6vuufA', name: 'Metics Media 한국어' },
    { id: 'UCDLlMjELbrJdETmSiAB68AA', name: '시민개발자 구씨' },
    { id: 'UCBtG00ljZ8R_DBQCTR4C00A', name: '기술노트with 알렉' },
    { id: 'UC7iAOLiALt2rtMVAWWl4pnw', name: '나도코딩' },
    { id: 'UCUpJs89fSBXNolQGOYKn0YQ', name: '노마드 코더 Nomad Coders' },
    { id: 'UCQNE2JmbasNYbjGAcuBiRRg', name: '조코딩 JoCoding' },
    { id: 'UCSLrpBAzr-ROVGHQ5EmxnUg', name: '코딩애플' },
    { id: 'UCvc8kv-i5fvFTJBFAk6n1SA', name: '생활코딩' },
    { id: 'UCSEOUzkGNCT_29EU_vnBYjg', name: '개발바닥' },
    { id: 'UCt2wAAXgm87ACiQnDHQEW6Q', name: '테디노트 TeddyNote' },
    { id: 'UC2L1DgDMD5pJ-35G47Objfw', name: '빵형의 개발도상국' },
    { id: 'UCeN2YeJcBCRJoXgzF_OU3qw', name: '안될공학' },
    { id: 'UCt9jbjxLBawaSaEsGB87D6g', name: '딥러닝 호형' },
    { id: 'UCHcG02L6TSS-StkSbqVy6Fg', name: '코드없는 프로그래밍' },
    { id: 'UC1_ZZYZsHh2_DzCXN4VGVcQ', name: '개발동생' },
  ].map((ch) => ({
    name: `YouTube: ${ch.name}`,
    type: 'YOUTUBE_CHANNEL' as const,
    url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`,
    config: { channelId: ch.id, maxResults: 10, fetchTranscript: true },
    cronExpr: '0 */3 * * *', // 3시간마다
    tags: ['youtube', 'korean', 'tech'],
  })),

  // =============================================
  // YouTube 채널 — 글로벌
  // =============================================
  ...[
    { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', name: 'Google for Developers' },
    { id: 'UCsBjURrPoezykLs9EqgamOA', name: 'Fireship' },
    { id: 'UCbfYPyITQ-7l4upoX8nvctg', name: 'Two Minute Papers' },
    { id: 'UCXZCJLdBC09xxGZ6gcdrc6A', name: 'OpenAI' },
    { id: 'UCFbNIlppjAuEX4znoulh0Cw', name: 'Web Dev Simplified' },
    { id: 'UCW5YeuERMmlnqo4oq8vwUpg', name: 'The Net Ninja' },
    { id: 'UC29ju8bIPH5as8OGnQzwJyA', name: 'Traversy Media' },
    { id: 'UCyU5wkjgQYGRB0hIHMwm2Sg', name: 'Theo - t3.gg' },
  ].map((ch) => ({
    name: `YouTube: ${ch.name}`,
    type: 'YOUTUBE_CHANNEL' as const,
    url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`,
    config: { channelId: ch.id, maxResults: 10, fetchTranscript: true },
    cronExpr: '0 */3 * * *',
    tags: ['youtube', 'global', 'tech'],
  })),

  // =============================================
  // RSS 피드 — IT/AI 뉴스
  // =============================================
  {
    name: 'Google News: AI 한국어',
    type: 'RSS_FEED',
    url: 'https://news.google.com/rss/search?q=%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5+OR+AI+OR+ChatGPT+when:7d&hl=ko&gl=KR&ceid=KR:ko',
    config: { maxItems: 50 },
    cronExpr: '0 */2 * * *', // 2시간마다
    tags: ['news', 'ai', 'korean'],
  },
  {
    name: 'Hacker News (Best)',
    type: 'RSS_FEED',
    url: 'https://hnrss.org/best',
    config: { maxItems: 30 },
    cronExpr: '0 */4 * * *',
    tags: ['news', 'tech', 'hackernews'],
  },
  {
    name: 'TechCrunch AI',
    type: 'RSS_FEED',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    config: { maxItems: 20 },
    cronExpr: '0 */4 * * *',
    tags: ['news', 'ai', 'techcrunch'],
  },
  {
    name: 'The Verge AI',
    type: 'RSS_FEED',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
    config: { maxItems: 20 },
    cronExpr: '0 */4 * * *',
    tags: ['news', 'ai', 'verge'],
  },
  {
    name: 'Ars Technica AI',
    type: 'RSS_FEED',
    url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',
    config: { maxItems: 20 },
    cronExpr: '0 */6 * * *',
    tags: ['news', 'tech', 'arstechnica'],
  },
  {
    name: 'CSS-Tricks',
    type: 'RSS_FEED',
    url: 'https://css-tricks.com/feed/',
    config: { maxItems: 15 },
    cronExpr: '0 */6 * * *',
    tags: ['design', 'frontend', 'css'],
  },
  {
    name: 'Smashing Magazine',
    type: 'RSS_FEED',
    url: 'https://www.smashingmagazine.com/feed/',
    config: { maxItems: 15 },
    cronExpr: '0 */6 * * *',
    tags: ['design', 'frontend', 'ux'],
  },
  {
    name: 'A List Apart',
    type: 'RSS_FEED',
    url: 'https://alistapart.com/main/feed/',
    config: { maxItems: 10 },
    cronExpr: '0 8 * * *', // 매일 08시
    tags: ['design', 'frontend', 'web'],
  },
  {
    name: 'Dev.to (Top)',
    type: 'RSS_FEED',
    url: 'https://dev.to/feed/top/week',
    config: { maxItems: 20 },
    cronExpr: '0 */6 * * *',
    tags: ['dev', 'community', 'tech'],
  },
  {
    name: 'OpenAI Blog',
    type: 'RSS_FEED',
    url: 'https://openai.com/blog/rss.xml',
    config: { maxItems: 10 },
    cronExpr: '0 */6 * * *',
    tags: ['ai', 'openai', 'research'],
  },
  {
    name: 'Anthropic News',
    type: 'RSS_FEED',
    url: 'https://www.anthropic.com/rss.xml',
    config: { maxItems: 10 },
    cronExpr: '0 */6 * * *',
    tags: ['ai', 'anthropic', 'research'],
  },
  {
    name: 'GeekNews',
    type: 'RSS_FEED',
    url: 'https://news.hada.io/rss/news',
    config: { maxItems: 30 },
    cronExpr: '0 */3 * * *',
    tags: ['news', 'tech', 'korean', 'geeknews'],
  },

  // =============================================
  // 웹 크롤링 — IT/디자인 블로그
  // =============================================
  {
    name: 'Google AI Blog',
    type: 'WEB_CRAWL',
    url: 'https://blog.google/technology/ai/',
    config: { selector: 'article', maxDepth: 1, followLinks: false },
    cronExpr: '0 8 * * *',
    tags: ['ai', 'google', 'blog'],
  },
  {
    name: 'Meta AI Blog',
    type: 'WEB_CRAWL',
    url: 'https://ai.meta.com/blog/',
    config: { selector: 'article', maxDepth: 1, followLinks: false },
    cronExpr: '0 8 * * *',
    tags: ['ai', 'meta', 'blog'],
  },
  {
    name: 'Vercel Blog',
    type: 'WEB_CRAWL',
    url: 'https://vercel.com/blog',
    config: { selector: 'article', maxDepth: 1, followLinks: false },
    cronExpr: '0 9 * * *',
    tags: ['frontend', 'nextjs', 'vercel'],
  },
  {
    name: 'Tailwind CSS Blog',
    type: 'WEB_CRAWL',
    url: 'https://tailwindcss.com/blog',
    config: { selector: 'article', maxDepth: 1, followLinks: false },
    cronExpr: '0 9 * * *',
    tags: ['design', 'css', 'tailwind'],
  },
];

async function seed() {
  console.log(`Seeding ${SOURCES.length} IT sources...`);

  let created = 0;
  let skipped = 0;

  for (const source of SOURCES) {
    // 이름으로 중복 체크
    const existing = await prisma.collectorSource.findFirst({
      where: { name: source.name },
    });

    if (existing) {
      console.log(`  [skip] ${source.name} (already exists)`);
      skipped++;
      continue;
    }

    await prisma.collectorSource.create({
      data: {
        name: source.name,
        type: source.type,
        url: source.url,
        config: source.config as Prisma.InputJsonValue,
        cronExpr: source.cronExpr,
        enabled: true,
        tags: source.tags,
      },
    });

    console.log(`  [created] ${source.name}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
