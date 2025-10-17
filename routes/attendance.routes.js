const express = require("express");
const {
  punchIn,
  punchOut,
  getAttendance,
} = require("../controllers/attendance.controller");
const { verifyToken, verifyEmployee, verifyAdmin } = require("../middleware/auth");
const upload = require("../middleware/upload"); // multer parser

const router = express.Router();

router.post("/punch-in", verifyToken, verifyEmployee, upload.single("photo"), punchIn);
router.post("/punch-out", verifyToken, verifyEmployee, upload.single("photo"), punchOut);

router.get("/my-attendance", verifyToken, verifyEmployee, getAttendance);
router.get("/attendance/:userId", verifyToken, verifyAdmin, getAttendance);

module.exports = router;
