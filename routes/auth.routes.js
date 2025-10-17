// routes/auth.routes.js
import express from "express";
import { login, createEmployee } from "../controllers/auth.controller.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import { validateEmployeeCreation } from "../middleware/validators.js";

const router = express.Router();

router.post("/login", login);
router.post("/create-employee", verifyToken, verifyAdmin, validateEmployeeCreation, createEmployee);
// Logout user by clearing the token cookie
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.status(200).json({ message: "Logged out successfully" });
});

// Get current logged-in user
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json({ user });
    console.log("🍪 Cookies:", req.cookies);
    console.log("🛂 Decoded token:", decoded);

  } catch {
    res.status(500).json({ message: "Failed to get user" });
  }
});


export default router;
