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
