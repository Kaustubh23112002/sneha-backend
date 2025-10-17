const express = require("express");
const { verifyToken, verifyEmployee } = require("../middleware/auth");
const { getMyProfile } = require("../controllers/employee.controller");

const router = express.Router();

router.get("/me", verifyToken, verifyEmployee, getMyProfile);

module.exports = router;