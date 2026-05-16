# P2: Real-Time Updates (SSE) — Execution Plan

## Approach
Use Server-Sent Events (SSE) — lighter than WebSockets for one-way server→client push.

## Backend

### 1. Event Broadcaster Service
- In-memory `EventEmitter` for local broadcast
- Methods: `subscribe(clientId)`, `unsubscribe(clientId)`, `broadcast(event, data)`
- Client stored as `Response` objects with SSE headers

### 2. SSE Controller
- `GET /api/v1/events/stream`
- Auth: `JwtAuthGuard`
- Sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Sends `event: connected` on connect
- Keep-alive ping every 30s

### 3. Emit Events from Key Places
- `BugsController` → `bug:status_changed`, `bug:assigned`
- `AiAnalysisWorker` → `bug:new` (when new bug created)
- `UserNotificationsService` → `notification:new`

## Dashboard

### 1. Event Source Hook
- `useEventSource()` hook that creates `EventSource` to `/api/v1/events/stream`
- Auto-reconnect with exponential backoff
- Parse SSE events and invoke callbacks

### 2. Integration Points
- `NotificationBell` → listen for `notification:new`, refresh count immediately
- `BugsPage` → listen for `bug:new`, show "New bugs available" banner
- `BugDetailPage` → listen for `bug:status_changed`, refresh if relevant

## Files to Create/Modify
1. `backend/src/modules/events/events-sse.service.ts`
2. `backend/src/modules/events/events.controller.ts`
3. `backend/src/modules/events/events.module.ts`
4. Update `AppModule` to import `EventsModule`
5. Update `BugsController` to emit events
6. Update `AiAnalysisWorker` to emit events
7. `dashboard/src/hooks/useEventSource.ts`
8. Update `NotificationBell.tsx`
9. Update `BugsPage.tsx`
