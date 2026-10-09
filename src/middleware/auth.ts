import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface AuthRequest extends Request {
  user?: { id: string; role: string; email: string };
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ message: "Authentication required." });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (!payload.sub || payload.role !== "HR") return res.status(403).json({ message: "Access denied." });
    req.user = { id: String(payload.sub), role: String(payload.role), email: String(payload.email || "") };
    next();
  } catch {
    return res.status(401).json({ message: "Session expired or invalid. Please sign in again." });
  }
}
