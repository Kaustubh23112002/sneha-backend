const jwt = require("jsonwebtoken");
const User = require("../models/User");

const verifyToken = (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers["authorization"]?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "Auth token missing" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, role }
    next();
  } catch (err) {
    console.error("verifyToken error:", err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

const verifyAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin access only" });
  }
  next();
};

const verifyEmployee = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Not authenticated" });
  if (req.user.role !== "employee") {
    return res.status(403).json({ message: "Employee access only" });
  }
  next();
};

module.exports = {
  verifyToken,
  verifyAdmin,
  verifyEmployee,
};
