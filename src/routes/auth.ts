import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { User } from "../models/User.js";
import { config } from "../config.js";

const router = Router();
const schema = z.object({ email: z.string().email().max(180), password: z.string().min(1).max(200) });

router.post("/login", async (req, res, next) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter a valid email and password." });
    const email = parsed.data.email.toLowerCase().trim();
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }
    const token = jwt.sign({ role: user.role, email: user.email }, config.jwtSecret, {
      subject: user.id, expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
    });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { next(error); }
});

export default router;
