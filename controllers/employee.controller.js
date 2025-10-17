// controllers/employee.controller.js
import User from "../models/User.js";

export const getMyProfile = async (req, res) => {
  try {
    const employee = await User.findById(req.user.id).select("-password");
    if (!employee || employee.role !== "employee") {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.status(200).json({ employee });
  } catch (err) {
    console.error("Error fetching employee profile:", err);
    res.status(500).json({ message: "Server error" });
  }
};
