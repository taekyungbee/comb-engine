# API Authentication Guide

## Overview

This document explains the authentication system for comb-engine APIs. All 13 endpoints are protected by an authentication layer to ensure secure access to RAG infrastructure.

## Authentication Methods

### API Key Authentication

Most system-to-system integrations (such as from `comb-hub` or `@side/comb-client`) should use an API Key. You must include it in the `Authorization` header of your HTTP requests:

```
Authorization: ApiKey rag_xxxxxxxxxxxxxxxxxxxxxxxx...
```

### Session Authentication (Web UI)

For direct browser access to the comb-engine dashboard, authentication is handled via NextAuth sessions (Google OAuth). The same API routes seamlessly support both API keys and session cookies.

## Rate Limiting

To ensure fair usage, API requests are rate-limited per API key (with a fallback to IP address for anonymous requests).

- **Default Limit:** 1000 requests per minute per API key.
- **Headers Returned:**
  - `X-RateLimit-Limit`: Maximum requests allowed per window.
  - `X-RateLimit-Remaining`: Remaining requests in the current window.
  - `X-RateLimit-Reset`: Timestamp when the limit resets.
- **On Exceed:** Returns an HTTP 429 status code with `RATE_LIMIT_EXCEEDED`.

## Endpoints

### 1. POST /api/search
- **Purpose:** RAG semantic search.
- **Auth:** API Key or Session
- **Role:** Any authenticated user
- **Body:** `{ query, limit?, threshold?, sourceTypes?, tags?, projectId?, collectionIds? }`
- **Response:** `{ success, data: { results, count } }`

### 2. POST /api/ingest
- **Purpose:** Data ingestion (text or image).
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Body:** `{ title, content, url?, tags?, collectionId?, projectId?, metadata? }` (or multipart for images)
- **Response:** `{ success, data: { status } }`

### 3. POST /api/collect
- **Purpose:** Trigger document collection.
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Body:** `{ sourceId?, sourceIds? }`
- **Response:** `{ success, data: { results } }`

### 4. GET /api/stats
- **Purpose:** Retrieve index statistics.
- **Auth:** API Key or Session
- **Role:** Any authenticated user
- **Response:** `{ success, data: { totalDocuments, ... } }`

### 5. GET /api/sources
- **Purpose:** List all configured sources.
- **Auth:** API Key or Session
- **Role:** Any authenticated user
- **Response:** `{ success, data: [...] }`

### 6. POST /api/sources
- **Purpose:** Create a new source.
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Response:** `{ success, data: {...} }`

### 7. GET /api/sources/[id]
- **Purpose:** Retrieve a specific source.
- **Auth:** API Key or Session
- **Role:** Any authenticated user
- **Response:** `{ success, data: {...} }`

### 8. PUT /api/sources/[id]
- **Purpose:** Update a specific source.
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Response:** `{ success, data: {...} }`

### 9. DELETE /api/sources/[id]
- **Purpose:** Delete a specific source.
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Response:** `{ success, data: { deleted: true } }`

### 10. GET /api/collections
- **Purpose:** List collections and collection runs.
- **Auth:** API Key or Session
- **Role:** Any authenticated user
- **Response:** `{ success, data: { runs, pagination } }`

### 11. GET /api/api-keys
- **Purpose:** List user's API keys (masked).
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Response:** `{ success, data: [...] }`

### 12. POST /api/api-keys
- **Purpose:** Generate a new API key.
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Body:** `{ name, expiresInDays? }`
- **Response:** `{ success, data: { ..., key } }`

### 13. DELETE /api/api-keys/[id]
- **Purpose:** Revoke an API key.
- **Auth:** API Key or Session
- **Role:** ADMIN, MEMBER
- **Response:** `{ success, data: { deleted: true } }`

*(Note: `/api/auth/me` and `/api/auth/[...nextauth]` are handled by NextAuth)*

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid API key / session. |
| `AUTH_ERROR` | 401 | Authentication check failed (e.g., expired key). |
| `FORBIDDEN` | 403 | Insufficient role to access endpoint. |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded. |
| `NOT_FOUND` | 404 | Resource not found. |
| `VALIDATION_ERROR` | 400 | Invalid request parameters or body. |

## Migration Guide

We are currently transitioning from the `COMB_API_KEY` environment variable to Database-backed API keys.

1. **Transition Period:** During this period, both `COMB_API_KEY` and DB API keys will be accepted by consumers.
2. **Post-Migration:** The `COMB_API_KEY` environment variable will be deprecated, and only DB API keys generated via the dashboard will be supported.
