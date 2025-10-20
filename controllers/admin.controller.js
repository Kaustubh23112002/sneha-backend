import User from "../models/User.js";
import Attendance from "../models/Attendance.js";

export const getAllEmployees = async (req, res) => {
  try {
    const employees = await User.find({ role: "employee" }).select(
      "fullName email phoneNumber address shiftTimings"
    );
    // Optionally, join attendance summary
    // For each employee, fetch attendance records or last login / last punch etc.
    const result = await Promise.all(
      employees.map(async (emp) => {
        const attendance = await Attendance.find({ user: emp._id });
        return {
          ...emp.toObject(),
          attendance,
        };
      })
    );
    res.status(200).json({ employees: result });
  } catch (err) {
    console.error("getAllEmployees error:", err);
    res.status(500).json({ message: "Server error" });
  }
};


export const updateEmployeeDetails = async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, phoneNumber, address, salary, shiftTimings } = req.body;

    const user = await User.findById(userId);
    if (!user || user.role !== "employee") {
      return res.status(404).json({ message: "Employee not found" });
    }

    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (address) user.address = address;
    if (salary) user.salary = salary;
    if (shiftTimings) user.shiftTimings = shiftTimings;

    await user.save();

    res.status(200).json({ message: "Employee updated", user });
  } catch (err) {
    console.error("updateEmployeeDetails error:", err);
    res.status(500).json({ message: "Server error" });
  }
};
