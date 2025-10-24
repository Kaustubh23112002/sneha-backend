// routes/auth.routes.js
import express from "express";
import { login, createEmployee } from "../controllers/auth.controller.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import { validateEmployeeCreation } from "../middleware/validators.js";
import User from "../models/User.js";

const router = express.Router();

// Login + create employee
router.post("/login", login);
router.post(
  "/create-employee",
  verifyToken,
  verifyAdmin,
  validateEmployeeCreation,
  createEmployee
);

// Logout: clear cookie and return once
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  return res.status(200).json({ message: "Logged out successfully" });
});

// Get current logged-in user
router.get("/me", verifyToken, async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" }); // stop here
    }

    // Optional safe logging
    console.log("🍪 Cookies:", req.cookies);

    // Never reference undefined 'decoded'; verifyToken already decoded and set req.user
    // console.log("🛂 Decoded token:", req.user); // safe if you need it

    return res.status(200).json({ user }); // stop here
  } catch (err) {
    return next(err); // let the global error handler respond
  }
});

export default router;
