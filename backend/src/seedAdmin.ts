import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { User } from "./models/User.js";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "HR Administrator";
  if (!email || !password || password.length < 12) {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) in .env before seeding.");
  }
  await mongoose.connect(config.mongoUri);
  const passwordHash = await bcrypt.hash(password, 12);
  await User.findOneAndUpdate({ email }, { name, email, passwordHash, role: "HR" }, { upsert: true, new: true, setDefaultsOnInsert: true });
  console.log(`HR account ready: ${email}`);
  await mongoose.disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });
