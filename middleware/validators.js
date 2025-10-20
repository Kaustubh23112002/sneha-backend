// middleware/validators.js
import { body, validationResult } from "express-validator";

export const validateEmployeeCreation = [
  body("fullName").notEmpty().withMessage("Full name is required"),
  body("email").isEmail().withMessage("Valid email is required"),
  body("password").isLength({ min: 6 }).withMessage("Password min length 6"),
  body("phoneNumber").notEmpty().withMessage("Phone number is required"),
  body("address").notEmpty(),
  body("salary").isNumeric().withMessage("Salary must be numeric"),
  body("shiftTimings").isArray().withMessage("shiftTimings must be array"),
  body("shiftTimings.*.start").matches(/^\d{2}:\d{2}$/).withMessage("Start time format HH:mm"),
  body("shiftTimings.*.end").matches(/^\d{2}:\d{2}$/).withMessage("End time format HH:mm"),

  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];
