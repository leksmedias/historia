# Admin Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single-admin authentication wall — first-run setup page, login page, 30-day JWT httpOnly cookie, all routes protected.

**Architecture:** Server issues a signed JWT stored in an httpOnly cookie on login/setup. A middleware verifies the cookie on every API route except `/api/auth/*`. The React frontend checks `/api/auth/status` on mount and gates all pages behind a `ProtectedRoute` that redirects to `/setup` or `/login` as needed.

**Tech Stack:** bcryptjs (password hashing), jsonwebtoken (JWT sign/verify), cookie-parser (Express cookie reading), React Context (auth state), React Router v6 (redirects), shadcn/ui (form components), Vitest + jsdom (tests)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modified | `shared/schema.ts` | Add `admin` table |
| Created | `server/middleware/requireAuth.ts` | Verify JWT cookie on API routes |
| Created | `server/routes/auth.ts` | `/api/auth/status`, `/setup`, `/login`, `/logout` |
| Modified | `server/index.ts` | Wire cookie-parser + auth routes + middleware |
| Created | `src/lib/AuthContext.tsx` | Auth state, login/logout helpers |
| Created | `src/components/ProtectedRoute.tsx` | Gate all app routes |
| Created | `src/pages/Setup.tsx` | First-run account creation |
| Created | `src/pages/Login.tsx` | Returning user login |
| Modified | `src/App.tsx` | Add AuthProvider, setup/login routes, ProtectedRoute |
| Modified | `src/components/AppSidebar.tsx` | Add logout button at bottom |
| Modified | `DEPLOYMENT.md` | Document JWT_SECRET env var |

---

## Task 1: Install dependencies

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install server auth packages**

```bash
cd C:/Users/leksi/Desktop/projects/historia
npm install bcryptjs jsonwebtoken cookie-parser
npm install --save-dev @types/bcryptjs @types/jsonwebtoken @types/cookie-parser
```

Expected output: packages added with no errors.

- [ ] **Step 2: Verify packages are in package.json**

```bash
grep -E "bcryptjs|jsonwebtoken|cookie-parser" package.json
```

Expected: three lines showing the packages under `dependencies` and `@types/*` under `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add auth dependencies (bcryptjs, jsonwebtoken, cookie-parser)"
```

---

## Task 2: Add admin table to schema

**Files:**
- Modify: `shared/schema.ts`

- [ ] **Step 1: Add the admin table**

Open `shared/schema.ts`. Add this import at the top (add `serial` to the existing import):

```ts
import { pgTable, text, integer, boolean, timestamp, jsonb, uuid, serial } from "drizzle-orm/pg-core";
```

Then append the `admin` table after the `scenes` table:

```ts
export const admin = pgTable("admin", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  password_hash: text("password_hash").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
});
```

- [ ] **Step 2: Push schema to database**

```bash
npm run db:push
```

Expected: Drizzle prints that it created the `admin` table. No errors.

- [ ] **Step 3: Verify table exists**

```bash
psql $DATABASE_URL -c "\d admin"
```

Expected: shows columns `id`, `username`, `password_hash`, `created_at`.

- [ ] **Step 4: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add admin table to schema"
```

---

## Task 3: Add JWT_SECRET to environment

**Files:**
- Modify: `.env`
- Modify: `server/index.ts`

- [ ] **Step 1: Generate a secret and add to .env**

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output. Add to `.env`:

```env
JWT_SECRET=<paste the hex string here>
```

- [ ] **Step 2: Add startup validation in server/index.ts**

Open `server/index.ts`. After `dotenv.config();`, add:

```ts
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in .env — generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");
}
```

- [ ] **Step 3: Verify server still starts**

```bash
npm run server
```

Expected: `Server running on port 3001` (or your PORT). Kill with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: validate JWT_SECRET on server startup"
```

---

## Task 4: Create requireAuth middleware

**Files:**
- Create: `server/middleware/requireAuth.ts`

- [ ] **Step 1: Create the middleware file**

Create `server/middleware/requireAuth.ts`:

```ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.historia_token;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    jwt.verify(token, process.env.JWT_SECRET as string);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
```

- [ ] **Step 2: Write a unit test**

Create `src/test/requireAuth.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";

const SECRET = "test-secret-abc123";

function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  try {
    jwt.verify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

describe("requireAuth token verification", () => {
  it("rejects missing token", () => {
    expect(verifyToken(undefined)).toBe(false);
  });

  it("rejects invalid token", () => {
    expect(verifyToken("not-a-valid-jwt")).toBe(false);
  });

  it("rejects token signed with wrong secret", () => {
    const bad = jwt.sign({ sub: "admin" }, "wrong-secret");
    expect(verifyToken(bad)).toBe(false);
  });

  it("accepts valid token", () => {
    const good = jwt.sign({ sub: "admin" }, SECRET);
    expect(verifyToken(good)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/test/requireAuth.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/middleware/requireAuth.ts src/test/requireAuth.test.ts
git commit -m "feat: add requireAuth middleware with JWT cookie verification"
```

---

## Task 5: Create auth routes

**Files:**
- Create: `server/routes/auth.ts`

- [ ] **Step 1: Create the auth route file**

Create `server/routes/auth.ts`:

```ts
import express, { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { admin } from "../../shared/schema.js";

const router = express.Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function issueToken(res: Response, username: string): void {
  const token = jwt.sign({ sub: username }, process.env.JWT_SECRET as string, { expiresIn: "30d" });
  res.cookie("historia_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: THIRTY_DAYS_MS,
  });
}

/** GET /api/auth/status */
router.get("/status", async (req: Request, res: Response) => {
  const [existing] = await db.select().from(admin).limit(1);
  const setup = !!existing;

  const token = req.cookies?.historia_token;
  let authenticated = false;
  if (token) {
    try {
      jwt.verify(token, process.env.JWT_SECRET as string);
      authenticated = true;
    } catch {}
  }

  res.json({ setup, authenticated });
});

/** POST /api/auth/setup */
router.post("/setup", async (req: Request, res: Response) => {
  const [existing] = await db.select().from(admin).limit(1);
  if (existing) {
    res.status(409).json({ error: "Admin already configured" });
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password || username.trim().length < 1 || password.length < 8) {
    res.status(400).json({ error: "Username required and password must be at least 8 characters" });
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);
  await db.insert(admin).values({ username: username.trim(), password_hash });

  issueToken(res, username.trim());
  res.json({ ok: true });
});

/** POST /api/auth/login */
router.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };
  const [existing] = await db.select().from(admin).limit(1);

  const valid =
    existing &&
    username === existing.username &&
    password &&
    (await bcrypt.compare(password, existing.password_hash));

  if (!valid) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  issueToken(res, existing.username);
  res.json({ ok: true });
});

/** POST /api/auth/logout */
router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie("historia_token");
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/auth.ts
git commit -m "feat: add auth routes (status, setup, login, logout)"
```

---

## Task 6: Wire auth into server/index.ts

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Update server/index.ts**

Replace the full content of `server/index.ts` with:

```ts
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";
import projectsRouter from "./routes/projects.js";
import assetsRouter from "./routes/assets.js";
import regenerateRouter from "./routes/regenerate.js";
import geminiProxyRouter from "./routes/gemini-proxy.js";
import renderRouter from "./routes/render.js";
import scriptToJsonRouter from "./routes/scriptToJson.js";
import authRouter from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";

dotenv.config();

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in .env — generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\"");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "5000", 10);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "50mb" }));
app.use(cookieParser());

// Auth routes — public, no token required
app.use("/api/auth", authRouter);

// All other API routes — require valid JWT cookie
app.use("/api", requireAuth);
app.use("/api/projects", projectsRouter);
app.use("/api", assetsRouter);
app.use("/api/regenerate", regenerateRouter);
app.use("/api/gemini-proxy", geminiProxyRouter);
app.use("/api/render", renderRouter);
app.use("/api/script-to-json", scriptToJsonRouter);

const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/uploads", express.static(uploadsDir));

const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
```

- [ ] **Step 2: Verify server starts**

```bash
npm run server
```

Expected: `Server running on port 3001`. Kill with Ctrl+C.

- [ ] **Step 3: Smoke-test the status endpoint**

```bash
curl http://localhost:3001/api/auth/status
```

Expected: `{"setup":false,"authenticated":false}`

- [ ] **Step 4: Commit**

```bash
git add server/index.ts
git commit -m "feat: wire cookie-parser, auth routes, and requireAuth middleware"
```

---

## Task 7: Create AuthContext

**Files:**
- Create: `src/lib/AuthContext.tsx`

- [ ] **Step 1: Create AuthContext**

Create `src/lib/AuthContext.tsx`:

```tsx
import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface AuthState {
  isSetup: boolean;
  isAuthenticated: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ isSetup: false, isAuthenticated: false, loading: true });

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status", { credentials: "include" });
      const data = await res.json() as { setup: boolean; authenticated: boolean };
      setState({ isSetup: data.setup, isAuthenticated: data.authenticated, loading: false });
    } catch {
      setState(s => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json() as { error: string };
      throw new Error(data.error ?? "Login failed");
    }
    setState(s => ({ ...s, isSetup: true, isAuthenticated: true }));
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setState(s => ({ ...s, isAuthenticated: false }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 2: Write a unit test**

Create `src/test/AuthContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/lib/AuthContext";

function StatusDisplay() {
  const { isSetup, isAuthenticated, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{isSetup ? "setup" : "not-setup"} {isAuthenticated ? "authed" : "not-authed"}</div>;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("AuthContext", () => {
  it("shows not-setup when status returns setup:false", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ setup: false, authenticated: false }),
    });

    render(<AuthProvider><StatusDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("not-setup not-authed")).toBeTruthy());
  });

  it("shows authed when status returns authenticated:true", async () => {
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ setup: true, authenticated: true }),
    });

    render(<AuthProvider><StatusDisplay /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("setup authed")).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/test/AuthContext.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/AuthContext.tsx src/test/AuthContext.test.tsx
git commit -m "feat: add AuthContext with login/logout/status"
```

---

## Task 8: Create ProtectedRoute

**Files:**
- Create: `src/components/ProtectedRoute.tsx`

- [ ] **Step 1: Create ProtectedRoute**

Create `src/components/ProtectedRoute.tsx`:

```tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isSetup, isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSetup) return <Navigate to="/setup" replace />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ProtectedRoute.tsx
git commit -m "feat: add ProtectedRoute component"
```

---

## Task 9: Create Setup page

**Files:**
- Create: `src/pages/Setup.tsx`

- [ ] **Step 1: Create Setup page**

Create `src/pages/Setup.tsx`:

```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

export default function Setup() {
  const { isAuthenticated, isSetup, loading, refreshStatus } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) navigate("/", { replace: true });
  }, [loading, isAuthenticated, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("Passwords do not match"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Setup failed"); return; }
      await refreshStatus();
      navigate("/", { replace: true });
    } catch {
      toast.error("Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Welcome to Historia</CardTitle>
          <CardDescription>Create your admin account to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Username</label>
              <Input value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Confirm password</label>
              <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Creating account…" : "Create account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Setup.tsx
git commit -m "feat: add first-run Setup page"
```

---

## Task 10: Create Login page

**Files:**
- Create: `src/pages/Login.tsx`

- [ ] **Step 1: Create Login page**

Create `src/pages/Login.tsx`:

```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function Login() {
  const { isAuthenticated, loading, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) navigate("/", { replace: true });
  }, [loading, isAuthenticated, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err.message ?? "Invalid username or password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="font-display text-2xl">Historia</CardTitle>
          <CardDescription>Sign in to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Username</label>
              <Input value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/Login.tsx
git commit -m "feat: add Login page"
```

---

## Task 11: Wire everything into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace App.tsx**

Replace the full content of `src/App.tsx` with:

```tsx
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { GenerationProvider } from "@/lib/GenerationContext";
import { AuthProvider } from "@/lib/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import ProjectStatus from "./pages/ProjectStatus";
import ProjectPreview from "./pages/ProjectPreview";
import Settings from "./pages/Settings";
import ErrorLog from "./pages/ErrorLog";
import JsonToVideo from "./pages/JsonToVideo";
import ImageModelTest from "./pages/ImageModelTest";
import ScriptToJson from "./pages/ScriptToJson";
import Setup from "./pages/Setup";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <GenerationProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/setup" element={<Setup />} />
              <Route path="/login" element={<Login />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <AppLayout>
                      <Routes>
                        <Route path="/" element={<Index />} />
                        <Route path="/projects" element={<Projects />} />
                        <Route path="/projects/:projectId" element={<ProjectStatus />} />
                        <Route path="/projects/:projectId/preview" element={<ProjectPreview />} />
                        <Route path="/settings" element={<Settings />} />
                        <Route path="/errors" element={<ErrorLog />} />
                        <Route path="/json-to-video" element={<JsonToVideo />} />
                        <Route path="/image-test" element={<ImageModelTest />} />
                        <Route path="/script-to-json" element={<ScriptToJson />} />
                        <Route path="*" element={<NotFound />} />
                      </Routes>
                    </AppLayout>
                  </ProtectedRoute>
                }
              />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </GenerationProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
```

- [ ] **Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire AuthProvider, ProtectedRoute, setup/login routes into App"
```

---

## Task 12: Add logout button to AppSidebar

**Files:**
- Modify: `src/components/AppSidebar.tsx`

- [ ] **Step 1: Add logout to AppSidebar**

Replace the full content of `src/components/AppSidebar.tsx` with:

```tsx
import { Plus, FolderOpen, Settings, AlertTriangle, FileJson, FlaskConical, FileCode, LogOut } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "New Project", url: "/", icon: Plus },
  { title: "Projects", url: "/projects", icon: FolderOpen },
  { title: "JSON Import", url: "/json-to-video", icon: FileJson },
  { title: "Script → JSON", url: "/script-to-json", icon: FileCode },
  { title: "Image Test", url: "/image-test", icon: FlaskConical },
  { title: "Error Log", url: "/errors", icon: AlertTriangle },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          <div className="shrink-0 w-7 h-7 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
            <span className="text-sm font-bold text-primary font-display leading-none">H</span>
          </div>
          {!collapsed && (
            <span className="text-lg font-display tracking-wide text-foreground">
              Historia
            </span>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-sidebar-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} className="hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground">
              <LogOut className="mr-2 h-4 w-4" />
              {!collapsed && <span>Logout</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AppSidebar.tsx
git commit -m "feat: add logout button to sidebar footer"
```

---

## Task 13: Update DEPLOYMENT.md

**Files:**
- Modify: `DEPLOYMENT.md`

- [ ] **Step 1: Add JWT_SECRET to the env vars section**

In `DEPLOYMENT.md`, find the `# ── Server` block in the `.env` example and add `JWT_SECRET` after `PORT`:

```env
# ── Server ─────────────────────────────────────────────────────────────────────
PORT=3001

# JWT secret for admin session cookies — generate with:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=your_64_byte_hex_secret_here
```

Also add a note in the **In-App Configuration** section (Section 9):

> **First-time setup:** On the first visit to the app, you will be shown a setup screen to create the admin username and password. This can only be done once. After that, every visit requires login. Sessions last 30 days.

- [ ] **Step 2: Commit**

```bash
git add DEPLOYMENT.md
git commit -m "docs: add JWT_SECRET and first-run setup instructions to DEPLOYMENT.md"
```

---

## Task 14: Build and full smoke-test

- [ ] **Step 1: Build the frontend**

```bash
npm run build
```

Expected: Vite build succeeds with no TypeScript errors.

- [ ] **Step 2: Start the server**

```bash
npm run server
```

- [ ] **Step 3: Test the full flow**

Open `http://localhost:3001` in a browser.

Expected sequence:
1. Redirected to `/setup`
2. Fill in username + password (8+ chars) → click Create account
3. Redirected to `/` (full app loads)
4. Click Logout in sidebar → redirected to `/login`
5. Fill in credentials → click Sign in → redirected to `/`
6. Close and reopen browser → still logged in (30-day cookie)
7. Try `curl http://localhost:3001/api/projects` → returns `401 Unauthorized`
8. `curl http://localhost:3001/api/auth/status` → returns `{"setup":true,"authenticated":false}`

- [ ] **Step 4: Run full test suite**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 5: Final commit and push**

```bash
git push origin main
```
