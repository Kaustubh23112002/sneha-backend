const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const adminRoutes = require("./routes/admin.routes.js");
const authRoutes = require("./routes/auth.routes.js");
const attendanceRoutes = require("./routes/attendance.routes.js");
const adminAttendanceRoutes = require("./routes/attendance.routes.js");
const employeeRoutes = require("./routes/employee.routes.js");

dotenv.config();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// CORS — allow frontend
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));

mongoose.connect(process.env.MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error("MongoDB connect error:", err));

app.use("/api/auth", authRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin-attendance", adminAttendanceRoutes);
app.use("/api/employees", employeeRoutes);

// Optional global error handler
app.use((err, req, res, next) => {
  console.error("Global error:", err);
  res.status(500).json({ message: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
