#!/usr/bin/env node

/**
 * RAG Collector MCP Server (stdio)
 * Claude Code/Desktop에서 벡터 검색, 텍스트/이미지 수집 등을 사용할 수 있도록 하는 MCP 서버
 *
 * Usage: node mcp-server.mjs
 * Env: RAG_COLLECTOR_URL (default: http://localhost:11009)
 *      RAG_API_KEY       - API Key (rag_xxx... 형식)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { extname } from 'path'

const BASE_URL = process.env.RAG_COLLECTOR_URL || 'http://localhost:11009'
const API_KEY = process.env.RAG_API_KEY || ''
const API_TIMEOUT = 30_000
const CHARACTER_LIMIT = 30_000

// =============================================
// Helper
// =============================================

async function apiCall(path, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT)
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `ApiKey ${API_KEY}` } : {}),
      ...(options.headers || {}),
    }
    const res = await fetch(`${BASE_URL}${path}`, { ...options, headers, signal: controller.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`API ${res.status}: ${res.statusText}${body ? ` - ${body.slice(0, 200)}` : ''}`)
    }
    return res.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

function handleError(error) {
  if (error?.name === 'AbortError') return 'Error: 요청 시간 초과 (30초). 검색 범위를 좁히거나 limit을 줄여주세요.'
  return `Error: ${error?.message || String(error)}`
}

function truncateOutput(text) {
  if (text.length <= CHARACTER_LIMIT) return text
  return text.slice(0, CHARACTER_LIMIT) + '\n\n... (응답이 잘렸습니다. limit 파라미터를 줄이거나 필터를 추가해주세요)'
}

const server = new McpServer({ name: 'rag-collector-mcp-server', version: '2.1.0' })

// =============================================
// Tools
// =============================================

// 1. 벡터 검색
server.registerTool('search', {
  title: 'RAG 벡터 검색',
  description: `RAG Collector에서 벡터 유사도 검색을 수행합니다.

Args:
  - query (string, required): 검색 쿼리
  - limit (number): 결과 수, 1-50 (default: 10)
  - threshold (number): 유사도 임계값 (default: 0.6)
  - sourceTypes (string[]): 소스 타입 필터
  - collectionIds (string[]): 컬렉션 ID 필터
  - tags (string[]): 태그 필터

Returns:
  유사도 순으로 정렬된 검색 결과 목록`,
  inputSchema: {
    query: z.string().describe('검색 쿼리'),
    limit: z.number().int().min(1).max(50).default(10).optional(),
    threshold: z.number().min(0).max(1).default(0.6).optional(),
    sourceTypes: z.array(z.string()).optional(),
    collectionIds: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (params) => {
  try {
    const result = await apiCall('/api/search', { method: 'POST', body: JSON.stringify(params) })
    return { content: [{ type: 'text', text: truncateOutput(JSON.stringify(result, null, 2)) }] }
  } catch (error) {
    return { content: [{ type: 'text', text: handleError(error) }], isError: true }
  }
})

// 2. 텍스트 수집
server.registerTool('ingest_text', {
  title: '텍스트 수집',
  description: `텍스트 콘텐츠를 RAG Collector에 수집합니다.

Args:
  - title (string, required): 문서 제목
  - content (string, required): 문서 내용
  - url (string): 원본 URL
  - tags (string[]): 태그
  - collectionId (string): 컬렉션 ID

Returns:
  수집 결과 (new/updated/skipped)`,
  inputSchema: {
    title: z.string().describe('문서 제목'),
    content: z.string().describe('문서 내용'),
    url: z.string().optional(),
    tags: z.array(z.string()).optional(),
    collectionId: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async (params) => {
  try {
    const result = await apiCall('/api/ingest', { method: 'POST', body: JSON.stringify(params) })
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return { content: [{ type: 'text', text: handleError(error) }], isError: true }
  }
})

// 3. 이미지 수집
server.registerTool('ingest_image', {
  title: '이미지 수집',
  description: `로컬 이미지 파일을 RAG Collector에 수집합니다.

Args:
  - filePath (string, required): 로컬 이미지 파일 경로
  - title (string, required): 이미지 제목
  - tags (string): 콤마로 구분된 태그
  - collectionId (string): 컬렉션 ID

Returns:
  수집 결과`,
  inputSchema: {
    filePath: z.string().describe('로컬 이미지 파일 경로'),
    title: z.string().describe('이미지 제목'),
    tags: z.string().optional(),
    collectionId: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
}, async (params) => {
  try {
    const { filePath, title, tags, collectionId } = params

    // 파일 읽기
    const fileBuffer = readFileSync(filePath)
    const ext = extname(filePath).toLowerCase()
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }
    const mimeType = mimeMap[ext] || 'application/octet-stream'

    // multipart/form-data 수동 구성
    const boundary = `----MCPBoundary${Date.now()}`
    const parts = []

    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}`)
    if (tags) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${tags}`)
    if (collectionId) parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="collectionId"\r\n\r\n${collectionId}`)

    const fileName = filePath.split('/').pop() || 'image'
    const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    const fileFooter = `\r\n--${boundary}--\r\n`

    const textBuffer = Buffer.from(parts.join('\r\n') + '\r\n')
    const headerBuffer = Buffer.from(fileHeader)
    const footerBuffer = Buffer.from(fileFooter)
    const body = Buffer.concat([textBuffer, headerBuffer, fileBuffer, footerBuffer])

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60_000)

    try {
      const res = await fetch(`${BASE_URL}/api/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          ...(API_KEY ? { Authorization: `ApiKey ${API_KEY}` } : {}),
        },
        body,
        signal: controller.signal,
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(`API ${res.status}: ${res.statusText}${errBody ? ` - ${errBody.slice(0, 200)}` : ''}`)
      }
      const result = await res.json()
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error) {
    return { content: [{ type: 'text', text: handleError(error) }], isError: true }
  }
})

// 4. 컬렉션 목록
server.registerTool('list_collections', {
  title: '컬렉션 목록',
  description: `접근 가능한 컬렉션 목록을 조회합니다.

Returns:
  컬렉션 목록 (이름, 설명, visibility, 문서 수)`,
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try {
    const result = await apiCall('/api/collections/manage')
    return { content: [{ type: 'text', text: truncateOutput(JSON.stringify(result, null, 2)) }] }
  } catch (error) {
    return { content: [{ type: 'text', text: handleError(error) }], isError: true }
  }
})

// 5. 통계 조회
server.registerTool('get_stats', {
  title: '통계 조회',
  description: `RAG Collector의 통계 정보를 조회합니다.

Returns:
  문서 수, 청크 수, 소스 타입별 분류`,
  inputSchema: {},
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}, async () => {
  try {
    const result = await apiCall('/api/stats')
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  } catch (error) {
    return { content: [{ type: 'text', text: handleError(error) }], isError: true }
  }
})

// =============================================
// Start
// =============================================

const transport = new StdioServerTransport()
await server.connect(transport)
