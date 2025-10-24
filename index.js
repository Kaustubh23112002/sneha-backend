// server.js (or index.js)
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";

// Routes
import adminRoutes from "./routes/admin.routes.js";
import authRoutes from "./routes/auth.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import adminAttendanceRoutes from "./routes/attendance.routes.js";
import employeeRoutes from "./routes/employee.routes.js";

dotenv.config();
const app = express();

// Core middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS — explicit allowlist + Authorization header + credentials + preflight
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,     // e.g., https://sneha-attendance.netlify.app
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    // Block unknown origins; allow exact matches (required when credentials = true)
    if (!origin) return cb(null, false);
    const ok = ALLOWED_ORIGINS.includes(origin);
    return cb(ok ? null : new Error("CORS origin blocked: " + origin), ok);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,                 // Access-Control-Allow-Credentials: true
  optionsSuccessStatus: 204,         // Successful OPTIONS
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));  // Handle all preflights globally

// DB connect
mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error("MongoDB connect error:", err));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin-attendance", adminAttendanceRoutes);
app.use("/api/employees", employeeRoutes);

// Optional global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  // If CORS origin blocked, return a clear 403 to surface in logs
  if (String(err.message || "").startsWith("CORS origin blocked")) {
    return res.status(403).json({ message: err.message });
  }
  res.status(500).json({ message: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
