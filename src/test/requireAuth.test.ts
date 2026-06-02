import { describe, it, expect } from "vitest";
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
