// controllers/auth.controller.js
import User from "../models/User.js";
import jwt from "jsonwebtoken";

export const login = async (req, res) => {
  const { email, password } = req.body;
  // console.log("🔐 Login Attempt:", { email, password });
  try {
    const user = await User.findOne({ email });
    if (!user) {
      console.log("❌ User not found with email:", email);
      return res.status(404).json({ message: "User not found" });
    }

    console.log("✅ User found:", user.email);
    // console.log("Stored hashed password:", user.password);

    const isMatch = await user.comparePassword(password);
    console.log("🔍 Password match result:", isMatch);
    if (!isMatch) {
      console.log("❌ Password did not match");
      return res.status(400).json({ message: "Wrong credentials" });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );
    res
      .cookie("token", token, {
        httpOnly: true,
        secure: true,
        sameSite: "None",
        maxAge: 24 * 60 * 60 * 1000,
      })
      .status(200)
      .json({
        message: "Login successful",
        token, // ✅ add this
        user: { id: user._id, fullName: user.fullName, role: user.role },
      });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

export const createEmployee = async (req, res) => {
  const {
    fullName,
    email,
    password,
    phoneNumber,
    address,
    salary,
    shiftTimings,
  } = req.body;
  try {
    const exist = await User.findOne({ $or: [{ email }, { phoneNumber }] });
    if (exist) {
      return res.status(400).json({ message: "Email or phone already used" });
    }

    const newUser = new User({
      fullName,
      email,
      password,
      phoneNumber,
      address,
      salary,
      shiftTimings,
      role: "employee",
    });

    await newUser.save();
    res.status(201).json({ message: "Employee created", user: newUser });
  } catch (err) {
    console.error("createEmployee error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
