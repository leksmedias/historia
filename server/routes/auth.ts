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
