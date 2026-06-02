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
