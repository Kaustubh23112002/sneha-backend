// models/Attendance.js
import mongoose from "mongoose";

const punchSchema = new mongoose.Schema({
  inTime: String,
  outTime: String,
  inPhotoUrl: String,
  outPhotoUrl: String,
  late: { type: Boolean, default: false },
  overtime: { type: Boolean, default: false },
  durationInMinutes: { type: Number }, // ➕ add this
}, { _id: false });


const attendanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true }, // "YYYY-MM-DD"
  punches: [punchSchema]
}, { timestamps: true });

const Attendance = mongoose.model("Attendance", attendanceSchema);
export default Attendance;
