const express = require("express");
const {
  getAllEmployees,
  updateEmployeeDetails,
} = require("../controllers/admin.controller");
const { verifyToken, verifyAdmin } = require("../middleware/auth");
const {
  getAttendanceByDate,
  getEmployeeHistory,
  editPunchTimes,
  getAttendanceByMonth,
} = require("../controllers/attendance.controller");

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

module.exports = router;
