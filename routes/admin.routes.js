// routes/admin.routes.js
import express from "express";
import {
  getAllEmployees,
  updateEmployeeDetails,
} from "../controllers/admin.controller.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import {
  getAttendanceByDate,
  getEmployeeHistory,
  editPunchTimes,
  getAttendanceByMonth,
} from "../controllers/attendance.controller.js";

const router = express.Router();
router.get("/employees", verifyToken, verifyAdmin, getAllEmployees);

// GET /api/admin/attendance?date=YYYY-MM-DD
router.get("/attendance", verifyToken, verifyAdmin, getAttendanceByDate);

// GET /api/admin/attendance/:userId/history
router.get(
  "/attendance/:userId/history",
  verifyToken,
  verifyAdmin,
  getEmployeeHistory
);

// PUT /api/admin/attendance/:attendanceId/edit
router.put(
  "/attendance/:attendanceId/edit",
  verifyToken,
  verifyAdmin,
  editPunchTimes
);

router.put(
  "/employees/:userId",
  verifyToken,
  verifyAdmin,
  updateEmployeeDetails
);

router.get(
  "/attendance/:userId/month",
  verifyToken,
  verifyAdmin,
  getAttendanceByMonth
);

export default router;
