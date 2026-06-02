import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toast } from "sonner";

export default function Setup() {
  const { isAuthenticated, loading, refreshStatus } = useAuth();
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
