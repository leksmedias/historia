# Admin Authentication — Design Spec
**Date:** 2026-06-02
**Status:** Approved

## Overview

Add a single-admin authentication wall to Historia. On first visit the user creates their admin account (username + password). Every subsequent visit requires login. A 30-day persistent JWT cookie keeps the user logged in across browser restarts. All app routes and all API routes are protected.

---

## 1. Database

New `admin` table in `shared/schema.ts`:

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer, PK | always 1 |
| `username` | text, not null | chosen at setup |
| `password_hash` | text, not null | bcrypt hash |
| `created_at` | timestamp | |

Only one row ever exists. The setup endpoint enforces this with a `SELECT` before `INSERT`.

---

## 2. Server

### Environment variable

`JWT_SECRET` — a long random string in `.env`. Server refuses to start if missing.

### New route file: `server/routes/auth.ts`

| Method | Path | Auth required | Description |
|--------|------|--------------|-------------|
| GET | `/api/auth/status` | No | Returns `{ setup: bool, authenticated: bool }` |
| POST | `/api/auth/setup` | No | One-time admin creation. Body: `{ username, password }`. Returns 409 if admin already exists. On success: issues JWT cookie + returns `{ ok: true }` |
| POST | `/api/auth/login` | No | Body: `{ username, password }`. Verifies bcrypt hash. Issues 30-day JWT httpOnly cookie. Returns 401 on bad credentials. |
| POST | `/api/auth/logout` | No | Clears the JWT cookie. |

### JWT cookie spec
- Name: `historia_token`
- `httpOnly: true` — not readable by JS
- `secure: true` when `NODE_ENV=production`, `false` in dev (HTTP)
- `sameSite: "lax"`
- `maxAge`: 30 days in milliseconds

### New middleware: `server/middleware/requireAuth.ts`

Reads `historia_token` cookie, verifies JWT with `JWT_SECRET`. Calls `next()` on success. Returns `401` on missing or invalid token.

Applied in `server/index.ts` to all routes **except**:
- `/api/auth/*`
- `/uploads/*` (static assets needed by the render pipeline)

### Dependencies to install
- `bcryptjs` + `@types/bcryptjs`
- `jsonwebtoken` + `@types/jsonwebtoken`
- `cookie-parser` + `@types/cookie-parser`

---

## 3. Frontend

### `src/lib/AuthContext.tsx`
- Calls `GET /api/auth/status` on mount
- Exposes: `{ isSetup, isAuthenticated, login, logout, loading }`
- `login(username, password)` — POSTs to `/api/auth/login`, updates context state
- `logout()` — POSTs to `/api/auth/logout`, redirects to `/login`
- Wraps the entire app (added in `App.tsx` outside `BrowserRouter`)

### `src/pages/Setup.tsx`
- Shown when `isSetup === false`
- Form: username, password, confirm password
- Client-side validation: passwords must match, min 8 chars
- On success: auto-logs in, redirects to `/`
- If already authenticated, redirects to `/`
- Route: `/setup`

### `src/pages/Login.tsx`
- Shown when `isSetup === true && isAuthenticated === false`
- Form: username, password
- Shows error on bad credentials ("Invalid username or password")
- If already authenticated, redirects to `/`
- Route: `/login`

### `src/components/ProtectedRoute.tsx`
Wraps all existing routes. Logic:
```
if loading       → show spinner
if !isSetup      → redirect to /setup
if !isAuthenticated → redirect to /login
else             → render children
```

### `App.tsx` changes
- Add `AuthProvider` wrapping `BrowserRouter`
- Add `/setup` and `/login` routes (unprotected)
- Wrap all existing routes with `<ProtectedRoute>`

### Logout button
Added to `AppLayout` nav. Calls `logout()` from `AuthContext`.

---

## 4. Flow Diagrams

### First-ever visit
```
User hits any URL
  → ProtectedRoute checks AuthContext
  → isSetup = false
  → redirect /setup
  → user fills username + password
  → POST /api/auth/setup → bcrypt hash stored → JWT cookie issued
  → redirect to /  (full app)
```

### Returning visit (logged out)
```
User hits any URL
  → ProtectedRoute checks AuthContext
  → isSetup = true, isAuthenticated = false
  → redirect /login
  → user fills credentials
  → POST /api/auth/login → JWT cookie issued
  → redirect to /  (full app)
```

### Returning visit (cookie still valid)
```
User hits any URL
  → GET /api/auth/status → { setup: true, authenticated: true }
  → ProtectedRoute renders normally
```

---

## 5. Security notes

- Passwords hashed with bcrypt (cost factor 12)
- JWT signed with `HS256` + `JWT_SECRET`
- Cookie is `httpOnly` — XSS cannot read the token
- `/api/auth/setup` and `/api/auth/login` return generic error messages (no "username not found" vs "wrong password" distinction) to prevent enumeration
- All other `/api/*` routes return `401` without a valid cookie

---

## 6. Files changed / created

| Action | File |
|--------|------|
| Modified | `shared/schema.ts` |
| Modified | `server/index.ts` |
| Created | `server/routes/auth.ts` |
| Created | `server/middleware/requireAuth.ts` |
| Created | `src/lib/AuthContext.tsx` |
| Created | `src/pages/Setup.tsx` |
| Created | `src/pages/Login.tsx` |
| Created | `src/components/ProtectedRoute.tsx` |
| Modified | `src/App.tsx` |
| Modified | `src/components/AppLayout.tsx` |
| Modified | `.env` / `DEPLOYMENT.md` |
