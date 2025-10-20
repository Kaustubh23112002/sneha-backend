// routes/employee.routes.js
import express from "express";
import { verifyToken, verifyEmployee } from "../middleware/auth.js";
import { getMyProfile } from "../controllers/employee.controller.js";

const router = express.Router();

router.get("/me", verifyToken, verifyEmployee, getMyProfile);

export default router;
