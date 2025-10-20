// routes/attendance.routes.js
import express from "express";
import { punchIn, punchOut, getAttendance } from "../controllers/attendance.controller.js";
import { verifyToken, verifyEmployee, verifyAdmin } from "../middleware/auth.js";
import upload from "../middleware/upload.js";  // multer parser

const router = express.Router();

router.post("/punch-in", verifyToken, verifyEmployee, upload.single("photo"), punchIn);
router.post("/punch-out", verifyToken, verifyEmployee, upload.single("photo"), punchOut);

router.get("/my-attendance", verifyToken, verifyEmployee, getAttendance);
router.get("/attendance/:userId", verifyToken, verifyAdmin, getAttendance);

export default router;
