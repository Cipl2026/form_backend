import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import employeeRoutes from "./routes/employees.js";

const app = express();

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin",
    },
  })
);

const allowedOrigins = config.clientOrigin
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

allowedOrigins.push("https://employee.nra.agency");

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / curl / mobile apps with no Origin header
      if (!origin) return cb(null, true);

      const clean = origin.replace(/\/+$/, "");

      // Allow localhost during development
      if (
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
          clean
        )
      ) {
        return cb(null, true);
      }

      if (allowedOrigins.includes(clean)) {
        return cb(null, true);
      }

      return cb(null, false);
    },
    credentials: false,
    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
    ],
  })
);

app.use(express.json({ limit: "1mb" }));

app.use(
  express.urlencoded({
    extended: true,
    limit: "1mb",
  })
);

// Root route
app.get("/", (_req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Employee API is running Successfully Thanks.",
    health: "/api/health",
  });
});

// Health check routes
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

// API rate limiting
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  })
);

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

// Application routes
app.use("/api/auth", authRoutes);
app.use("/api/employees", employeeRoutes);

// Centralized error handler
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);

    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: "Each image must be 5 MB or smaller.",
      });
    }

    if (err?.name === "MulterError") {
      return res.status(400).json({
        message: err.message,
      });
    }

    if (err?.name === "ValidationError") {
      return res.status(400).json({
        message: "Invalid data.",
      });
    }

    return res.status(500).json({
      message:
        err?.message || "Internal server error.",
    });
  }
);

// Start server
async function startServer() {
  try {
    await mongoose.connect(config.mongoUri);

    app.listen(config.port, () => {
      console.log(
        `API listening on http://localhost:${config.port}`
      );
    });
  } catch (error) {
    console.error("Failed to start API:", error);
    process.exit(1);
  }
}

void startServer();
