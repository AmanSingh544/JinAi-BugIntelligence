# Plan: Generic HTTP Integration Provider (Final)

## Goal
Add a `generic_http` integration provider that connects to **any** ticket system via configurable HTTP requests. Keep managed providers untouched. Incorporate SSRF protection, safe templating, strict validation, cookie auth with multiple cookies, and a purpose-built UI.

---

## Architecture Principles

1. **Provider logic separated from configuration** — one Generic HTTP class handles infinite APIs via JSON config.
2. **Managed providers stay code-backed** — Jira, GitHub, Meridian remain.
3. **Generic provider is config-backed** — auth, endpoints, templates, response mapping from UI.
4. **Shared schema contract** — single source of truth at `shared/provider-schema.ts`, imported by both backend and dashboard.
5. **Security first** — SSRF protection, secret whitelisting, no eval, timeouts, size limits.
6. **Config vars separated from bug vars** — `{{var.X}}` for user-defined integration values, `{{bug.X}}` for runtime bug payload.

---

## Shared Contract

**File:** `shared/provider-schema.ts` (project root, imported by both packages)

```typescript
export type ConfigFieldType = 'text' | 'password' | 'select' | 'textarea' | 'json' | 'key-value';

export interface ConfigField {
  name: string;
  type: ConfigFieldType;
  label: string;
  required?: boolean;
  hint?: string;
  options?: string[];
  placeholder?: string;
}

export interface ProviderSchema {
  id: string;
  name: string;
  type: 'managed' | 'generic';
  schemaVersion: number;
  fields: ConfigField[];
}
```

Both `backend/tsconfig.json` and `dashboard/tsconfig.app.json` already resolve relative imports outside their roots. Backend imports via `../../../../shared/provider-schema`, dashboard via `../../../shared/provider-schema`.

**Schema endpoints never echo saved secrets.** They only describe form fields.

---

## Generic HTTP Config Shape

Stored in `ProjectIntegration.config` (JSON):

```typescript
interface GenericHttpConfig {
  schemaVersion: number; // 1

  baseUrl: string;

  auth: {
    type: 'none' | 'bearer' | 'basic' | 'api_key' | 'cookie';
    // bearer
    token?: string;
    // basic
    username?: string;
    password?: string;
    // api_key
    headerName?: string;
    apiKey?: string;
    // cookie — supports multiple cookies
    cookies?: Record<string, string>;
  };

  endpoints: {
    healthCheck?: {
      url: string; // relative → prepended with baseUrl
      method: 'GET';
    };
    createTicket: {
      url: string;
      method: 'POST' | 'PUT' | 'PATCH';
    };
  };

  templates: {
    headers?: Record<string, string>; // may contain {{var.X}} and {{bug.X}}
    body: unknown; // JSON object with placeholders in string values
  };

  responseMapping: {
    ticketIdPath: string; // dot + bracket, e.g. "data.items[0].id"
    ticketUrlPath?: string;
  };

  variables?: Record<string, string>; // user-defined values, available as {{var.X}}
}
```

**URL building:** If endpoint URL starts with `http`, use as-is. Otherwise prepend `baseUrl` with normalized slashes.

---

## Template Variable System

Two explicit namespaces, never mixed:

| Prefix | Source | Example | Safe for templates? |
|--------|--------|---------|---------------------|
| `{{var.X}}` | `config.variables` + `baseUrl` auto-included | `{{var.tenantId}}`, `{{var.projectId}}` | Yes — user-defined, non-secret |
| `{{bug.X}}` | BugReportPayload at runtime | `{{bug.summary}}`, `{{bug.bugId}}` | Yes — runtime data |

**Secret fields are NEVER templatable.** The template engine receives a `varContext` built by whitelisting only:
- `baseUrl` (auto-included from top-level config)
- All keys from `config.variables`

Auth credentials (`token`, `password`, `apiKey`, `cookies`) are applied by the auth layer, not the template engine.

### Available `{{bug.X}}` variables

`bugId`, `summary`, `rootCause`, `stepsToReproduce`, `fixSuggestion`, `severity`, `errorMessage`, `stackTrace`, `affectedUrl`, `sessionId`, `browser`, `timestamp`

---

## Template Engine (Safe)

**File:** `backend/src/shared/template/template-engine.ts`

```typescript
function renderTemplate(template: string, varCtx: Record<string, string>, bugCtx: Record<string, string>): string;
function renderJsonTemplate(template: unknown, varCtx: Record<string, string>, bugCtx: Record<string, string>): unknown;
function getPath(obj: unknown, path: string): unknown; // supports "data.items[0].id"
```

**Rules:**
- Regex only: `/\{\{\s*(var|bug)\.([\w]+)\s*\}\}/g` — no eval, no Function.
- Missing variables → empty string `''`.
- `null`, `number`, `boolean` in JSON are **preserved** (only strings are substituted).
- Original template is **never mutated** — deep clone before rendering.
- `templates.body` must be valid JSON at validation time. It is parsed once, then rendered on each dispatch.

---

## SSRF Protection

**File:** `backend/src/shared/security/ssrf.guard.ts`

Before every outbound HTTP call in GenericHttpProvider:

1. Parse final URL.
2. Block:
   - `localhost`, `127.0.0.1`, `::1`
   - Private IP ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
   - Link-local: `169.254.0.0/16`, `fe80::/10`
   - Metadata: `169.254.169.254` (AWS/GCP/Azure)
   - Non-http(s) protocols
3. Env override: `ALLOW_INTERNAL_INTEGRATION_URLS=true` for on-prem.

---

## Response Mapping

Dot-notation + bracket index:
- `data.id` → `obj.data.id`
- `data.items[0].id` → `obj.data.items[0].id`

Tokenize path, walk object. Return `undefined` if any segment missing. **Reject anything more complex** (no wildcards, no filters, no recursive descent).

---

## Strict Request Lifecycle

Every `createTicket()` call follows this exact order:

1. **Build URL** — resolve relative URLs against `baseUrl`, render `{{var.X}}` placeholders
2. **SSRF check** — block private/internal URLs
3. **Auth headers** — add based on `auth.type` (bearer/basic/api_key/cookie)
4. **Render templates** — headers + body with `varContext` + `bugContext`
5. **Timeout & size cap** — `AbortSignal.timeout(10000)`, cap response processing at 1MB
6. **Send request**
7. **Parse response** — JSON only, size-guarded
8. **Map fields** — extract `ticketId` and `ticketUrl` via `responseMapping`
9. **Return** `TicketResult` or throw `ProviderError`

---

## Auth Modes

| Type | Behavior |
|------|----------|
| `none` | No auth headers |
| `bearer` | `Authorization: Bearer ${auth.token}` |
| `basic` | `Authorization: Basic ${base64(auth.username:auth.password)}` |
| `api_key` | `${auth.headerName}: ${auth.apiKey}` |
| `cookie` | `Cookie: ${Object.entries(auth.cookies).map(([k,v]) => `${k}=${v}`).join('; ')}` |

---

## validateCredentials() Semantics

Treat as **connectivity + config correctness**, not a guarantee that ticket creation will succeed.

1. If `endpoints.healthCheck` is configured: call it, expect 2xx.
2. If no healthCheck: skip network validation. Backend still validates required fields, JSON validity, and URL format.
3. **No OPTIONS/HEAD fallback.** Many APIs do not support these reliably.

---

## Validation (Two Layers)

### Frontend (instant feedback)
- Required fields present
- `templates.body` is valid JSON
- `endpoints.createTicket.method` ∈ {POST, PUT, PATCH}
- `auth.type` matches required sub-fields
- URL format looks valid

### Backend (source of truth)
- Same as frontend
- Strict DTO validation
- SSRF check on all resolved URLs
- `responseMapping.ticketIdPath` non-empty
- Reject unknown `auth.type` values
- Parse `templates.body` JSON once to confirm validity

---

## Meridian-Specific Example (via Generic HTTP)

From the provided curl, the generic config would be:

```json
{
  "schemaVersion": 1,
  "baseUrl": "https://meridian-be-production.up.railway.app",
  "auth": {
    "type": "cookie",
    "cookies": {
      "internal_refresh_token": "eyJhbG...",
      "customer_access_token": "eyJhbG...",
      "customer_refresh_token": "eyJhbG..."
    }
  },
  "endpoints": {
    "createTicket": {
      "url": "{{var.baseUrl}}/api/v1/tickets?tenant_id={{var.tenantId}}",
      "method": "POST"
    }
  },
  "templates": {
    "headers": {
      "x-portal-type": "customer",
      "content-type": "application/json",
      "accept": "application/json"
    },
    "body": {
      "title": "[Bug] {{bug.summary}}",
      "description": "{{bug.rootCause}}\n\n{{bug.fixSuggestion}}",
      "priority": "LOW",
      "category": "TASK",
      "tags": ["bug-intelligence", "auto-detected"],
      "attachment_ids": [],
      "projectId": "{{var.projectId}}",
      "environment": "{{var.environment}}"
    }
  },
  "responseMapping": {
    "ticketIdPath": "data.id",
    "ticketUrlPath": "data.url"
  },
  "variables": {
    "tenantId": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12",
    "projectId": "5dc81800-406f-4215-b7cd-1b15cc0046b2",
    "environment": "PRODUCTION"
  }
}
```

Note: `baseUrl` is auto-exposed as `{{var.baseUrl}}` without duplicating it into `variables`.

---

## Files to Create

### Project Root

1. **`shared/provider-schema.ts`** — Shared `ProviderSchema`, `ConfigField` interfaces

### Backend

2. **`backend/src/shared/template/template-engine.ts`** — Safe regex-only template engine with JSON support
3. **`backend/src/shared/security/ssrf.guard.ts`** — URL allowlist/blocklist
4. **`backend/src/modules/integrations/providers/provider.schema.ts`** — Schema definitions for all providers
5. **`backend/src/modules/integrations/providers/generic-http.provider.ts`** — Generic HTTP implementation

### Dashboard

6. **`dashboard/src/types/provider-schema.ts`** — Re-exports from `../../../shared/provider-schema` (or direct import)

---

## Files to Modify

### Backend

1. **`backend/src/modules/integrations/providers/integration.interface.ts`**
   - Import `ProviderSchema`
   - Add optional `readonly schema: ProviderSchema` to `IntegrationProvider`

2. **`backend/src/modules/integrations/providers/jira.provider.ts`** — Add `schema`
3. **`backend/src/modules/integrations/providers/github.provider.ts`** — Add `schema`
4. **`backend/src/modules/integrations/providers/meridian-3sc.provider.ts`** — Add `schema`

5. **`backend/src/modules/integrations/providers/integration.registry.ts`**
   - Inject `GenericHttpProvider`
   - `list()` returns full schemas: `{ id, name, type, schemaVersion, fields }`

6. **`backend/src/modules/integrations/integrations.controller.ts`**
   - Update `IntegrationProvidersController.list()` to return schemas
   - Add backend validation for generic_http on create/update

7. **`backend/src/modules/integrations/integrations.module.ts`**
   - Add `GenericHttpProvider`

### Dashboard

8. **`dashboard/src/api.ts`** — Add `ProviderSchema` type, update provider list return type

9. **`dashboard/src/pages/IntegrationsPage.tsx`** — Full refactor:
   - Fetch schemas from backend
   - `type === 'managed'`: render dynamic form from schema fields
   - `type === 'generic'`: render **purpose-built layout** with sections:
     - Auth block (type selector + conditional fields)
     - Endpoints block (baseUrl, healthCheck URL, createTicket URL + method)
     - Headers editor (key-value pairs)
     - Body Template editor (JSON textarea)
     - Response Mapping (ticketIdPath, ticketUrlPath)
     - Variables editor (key-value pairs for `{{var.X}}`)
   - Variable hint bar showing all available `{{var.X}}` and `{{bug.X}}` placeholders
   - Inline JSON validation
   - Test Connection button

---

## UI Layout for Generic HTTP (Purpose-Built)

```
┌─────────────────────────────────────────────┐
│  Provider: Custom HTTP / Webhook            │
├─────────────────────────────────────────────┤
│  Base URL                                   │
│  [ https://tracker.internal.com      ]      │
├─────────────────────────────────────────────┤
│  Authentication                             │
│  Type: [ Cookie ▼ ]                         │
│  Cookies:                                   │
│  [ internal_refresh_token ] [ eyJ... ] [×]  │
│  [ customer_access_token  ] [ eyJ... ] [×]  │
│  [ + Add Cookie ]                           │
├─────────────────────────────────────────────┤
│  Endpoints                                  │
│  Health Check: [ /api/health         ] GET  │
│  Create Ticket:[ /api/v1/tickets     ] POST │
├─────────────────────────────────────────────┤
│  Headers (optional)                         │
│  [ x-portal-type ] [ customer      ] [×]    │
│  [ + Add Header ]                           │
├─────────────────────────────────────────────┤
│  Body Template (JSON)                       │
│  Available: {{var.tenantId}} {{bug.summary}}│
│  ┌─────────────────────────────────────┐    │
│  │ { "title": "{{bug.summary}}", ... } │    │
│  └─────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│  Response Mapping                           │
│  Ticket ID path: [ data.id           ]      │
│  Ticket URL path: [ data.url         ]      │
├─────────────────────────────────────────────┤
│  Template Variables                         │
│  [ tenantId  ] [ a0eebc99...        ] [×]   │
│  [ projectId ] [ 5dc81800...        ] [×]   │
│  [ + Add Variable ]                         │
├─────────────────────────────────────────────┤
│  [ Test Connection ]  [ Save ]              │
└─────────────────────────────────────────────┘
```

---

## Implementation Order

1. **Shared contract** — `shared/provider-schema.ts`
2. **Template engine + SSRF guard** — pure utilities with unit tests
3. **GenericHttpProvider** — implements interface, all auth modes, cookie support
4. **Managed provider schemas** — add to Jira, GitHub, Meridian
5. **Backend endpoint update** — `/integrations/providers` returns schemas
6. **Backend validation** — enforce generic_http config rules on save
7. **Dashboard managed provider forms** — schema-driven rendering
8. **Dashboard generic HTTP editor** — purpose-built layout

---

## Testing Strategy

- **Template engine**: nested JSON, missing vars, null/number preservation, no mutation, `var` vs `bug` namespaces
- **SSRF guard**: allowed vs blocked URLs, env override
- **GenericHttpProvider**: mocked fetch per auth type (including multi-cookie), template rendering, response extraction, timeout behavior
- **Validation**: invalid JSON body, missing required fields, blocked URLs
- **E2E**: create generic_http integration → validate → trigger synthetic bug → verify mocked external API receives correct headers, cookies, body, and URL

---

## Security Checklist

- [ ] SSRF guard blocks localhost, private IPs, metadata endpoints
- [ ] Schema endpoints never echo saved secrets
- [ ] Template engine uses regex only — no eval/Function
- [ ] Secret auth fields never exposed in template context
- [ ] Request timeout capped at 10s
- [ ] Response size sanity check before full parse
- [ ] Backend validation is source of truth
- [ ] Auth credentials stored only in config JSON, never logged
- [ ] Multi-cookie values treated as secrets (same as tokens)

---

## Phase Context

Phase 2.5 operational maturity. Makes the integration subsystem production-ready for arbitrary APIs without per-tool code changes.