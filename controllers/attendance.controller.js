// controllers/attendance.controller.js
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import moment from "moment";
import { LATE_THRESHOLD_MIN, OVERTIME_THRESHOLD_MIN, getShiftBoundaryMoments } from "../utils/attendanceTime.js";

function getMatchingShift(user, timeNow) {
  return user.shiftTimings?.[0] || null;
}

// PUNCH IN: set late mark/minutes
export const punchIn = async (req, res) => {
  const userId = req.user.id;
  const file = req.file;
  if (!file) return res.status(400).json({ message: "Photo is required" });

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const today = moment().format("YYYY-MM-DD");
    const timeNow = moment();

    const shift = getMatchingShift(user, timeNow);
    if (!shift) return res.status(400).json({ message: "No shift defined" });

    let attendance = await Attendance.findOne({ user: userId, date: today });
    if (!attendance) attendance = new Attendance({ user: userId, date: today, punches: [] });

    const lastPunch = attendance.punches[attendance.punches.length - 1];
    if (lastPunch && !lastPunch.outTime) {
      return res.status(400).json({ message: "Already punched in, please punch out first" });
    }

    const { start: scheduledStart } = getShiftBoundaryMoments(today, shift);
    const lateMinutes = Math.max(0, timeNow.diff(scheduledStart, "minutes"));
    const lateMark = lateMinutes >= LATE_THRESHOLD_MIN;

    attendance.punches.push({
      inTime: timeNow.format("HH:mm"),
      inPhotoUrl: file.path,
      lateMark,
      lateMinutes,
    });

    await attendance.save();
    res.status(200).json({ message: "Punched in", attendance });
  } catch (err) {
    console.error("punchIn error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// PUNCH OUT: set overtime mark/minutes + duration
export const punchOut = async (req, res) => {
  const userId = req.user.id;
  const file = req.file;
  if (!file) return res.status(400).json({ message: "Photo is required" });

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const today = moment().format("YYYY-MM-DD");
    const timeNow = moment();

    const shift = getMatchingShift(user, timeNow);
    if (!shift) return res.status(400).json({ message: "No shift defined" });

    const attendance = await Attendance.findOne({ user: userId, date: today });
    if (!attendance) return res.status(400).json({ message: "No punch in found for today" });

    const lastPunch = attendance.punches[attendance.punches.length - 1];
    if (!lastPunch || lastPunch.outTime) {
      return res.status(400).json({ message: "No open punch to close" });
    }

    lastPunch.outTime = timeNow.format("HH:mm");
    lastPunch.outPhotoUrl = file.path;

    const inMoment = moment(lastPunch.inTime, "HH:mm");
    const outMoment = moment(lastPunch.outTime, "HH:mm");
    let duration = outMoment.diff(inMoment, "minutes");
    if (duration < 0) duration = 0;
    lastPunch.durationInMinutes = duration;

    const { end: scheduledEnd } = getShiftBoundaryMoments(today, shift);
    const overtimeMinutes = Math.max(0, timeNow.diff(scheduledEnd, "minutes"));
    const overtimeMark = overtimeMinutes >= OVERTIME_THRESHOLD_MIN;

    lastPunch.overtimeMark = overtimeMark;
    lastPunch.overtimeMinutes = overtimeMinutes;

    await attendance.save();
    res.status(200).json({ message: "Punched out", attendance });
  } catch (err) {
    console.error("punchOut error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// GET per-user: include totalLate/totalOvertime
export const getAttendance = async (req, res) => {
  const userId = req.params.userId || req.user.id;
  try {
    const records = await Attendance.find({ user: userId })
      .populate("user", "fullName email phoneNumber address salary shiftTimings");

    const enhanced = records.map((att) => {
      let totalMin = 0;
      let lateMin = 0;
      let overtimeMin = 0;

      att.punches.forEach((p, idx) => {
        if (p.durationInMinutes != null) {
          totalMin += Math.max(0, p.durationInMinutes);
        } else if (p.inTime && p.outTime) {
          const inM = moment(p.inTime, "HH:mm");
          const outM = moment(p.outTime, "HH:mm");
          const diff = outM.diff(inM, "minutes");
          totalMin += diff > 0 ? diff : 0;
        }
        if (idx === 0 && p.lateMinutes != null) lateMin += Math.max(0, p.lateMinutes);
        if (p.overtimeMinutes != null) overtimeMin += Math.max(0, p.overtimeMinutes);
      });

      return {
        ...att.toObject(),
        totalMinutes: totalMin,
        totalHours: (totalMin / 60).toFixed(2),
        totalLateMinutes: lateMin,
        totalOvertimeMinutes: overtimeMin,
        totalLateHours: (lateMin / 60).toFixed(2),
        totalOvertimeHours: (overtimeMin / 60).toFixed(2),
      };
    });

    res.status(200).json({ attendance: enhanced });
  } catch (err) {
    console.error("getAttendance error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// GET by date: include totals + per-punch computed duration
export const getAttendanceByDate = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const records = await Attendance.find({ date }).populate(
      "user",
      "fullName email phoneNumber address salary shiftTimings"
    );

    const enhanced = records.map((att) => {
      let totalMin = 0;
      let lateMin = 0;
      let overtimeMin = 0;

      const enhancedPunches = att.punches.map((punch, idx) => {
        let duration = punch.durationInMinutes;

        if (duration == null && punch.inTime && punch.outTime) {
          const inM = moment(punch.inTime, "HH:mm");
          const outM = moment(punch.outTime, "HH:mm");
          duration = outM.diff(inM, "minutes");
          if (duration < 0) duration = 0;
        }
        if (duration != null) totalMin += duration;

        if (idx === 0 && punch.lateMinutes != null) lateMin += Math.max(0, punch.lateMinutes);
        if (punch.overtimeMinutes != null) overtimeMin += Math.max(0, punch.overtimeMinutes);

        return {
          ...punch.toObject(),
          durationInMinutes: duration ?? 0,
        };
      });

      return {
        ...att.toObject(),
        punches: enhancedPunches,
        totalMinutes: totalMin,
        totalHours: (totalMin / 60).toFixed(2),
        totalLateMinutes: lateMin,
        totalOvertimeMinutes: overtimeMin,
        totalLateHours: (lateMin / 60).toFixed(2),
        totalOvertimeHours: (overtimeMin / 60).toFixed(2),
      };
    });

    res.status(200).json({ date, attendance: enhanced });
  } catch (err) {
    console.error("getAttendanceByDate error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Monthly with late/OT rollups
export const getAttendanceByMonth = async (req, res) => {
  try {
    const { userId } = req.params;
    const { month } = req.query;
    if (!month) return res.status(400).json({ message: "Month is required, format YYYY-MM" });

    const records = await Attendance.find({
      user: userId,
      date: { $regex: `^${month}` },
    })
      .sort({ date: 1 })
      .populate("user", "fullName email phoneNumber address salary shiftTimings");

    if (!records.length) return res.status(404).json({ message: "No attendance records found" });

    const user = records[0].user;

    let totalMinAll = 0;
    let totalLateAll = 0;
    let totalOvertimeAll = 0;

    const enhanced = records.map((att) => {
      let dayMin = 0;
      let dayLate = 0;
      let dayOT = 0;

      att.punches.forEach((p, idx) => {
        if (p.durationInMinutes != null) {
          dayMin += Math.max(0, p.durationInMinutes);
        } else if (p.inTime && p.outTime) {
          const inM = moment(p.inTime, "HH:mm");
          const outM = moment(p.outTime, "HH:mm");
          const diff = outM.diff(inM, "minutes");
          dayMin += diff > 0 ? diff : 0;
        }
        if (idx === 0 && p.lateMinutes != null) dayLate += Math.max(0, p.lateMinutes);
        if (p.overtimeMinutes != null) dayOT += Math.max(0, p.overtimeMinutes);
      });

      totalMinAll += dayMin;
      totalLateAll += dayLate;
      totalOvertimeAll += dayOT;

      return {
        ...att.toObject(),
        dayMinutes: dayMin,
        dayHours: (dayMin / 60).toFixed(2),
        totalLateMinutes: dayLate,
        totalOvertimeMinutes: dayOT,
        totalLateHours: (dayLate / 60).toFixed(2),
        totalOvertimeHours: (dayOT / 60).toFixed(2),
      };
    });

    res.status(200).json({
      user,
      records: enhanced,
      totalMinutes: totalMinAll,
      month,
      summary: {
        totalMinutes: totalMinAll,
        totalHours: (totalMinAll / 60).toFixed(2),
        totalLateMinutes: totalLateAll,
        totalOvertimeMinutes: totalOvertimeAll,
        totalLateHours: (totalLateAll / 60).toFixed(2),
        totalOvertimeHours: (totalOvertimeAll / 60).toFixed(2),
      },
    });
  } catch (err) {
    console.error("getAttendanceByMonth error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Admin edit: recompute duration/late/OT after time changes (optional enhancement)
export const editPunchTimes = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { punchIndex, inTime, outTime } = req.body;

    const attendance = await Attendance.findById(attendanceId).populate("user", "shiftTimings");
    if (!attendance) return res.status(404).json({ message: "Attendance record not found" });

    const punch = attendance.punches[punchIndex];
    if (!punch) return res.status(400).json({ message: "Invalid punch index" });

    if (inTime !== undefined && inTime !== "") punch.inTime = inTime;
    if (outTime !== undefined && outTime !== "") punch.outTime = outTime;

    const shift = attendance.user?.shiftTimings?.[0];
    if (shift) {
      const { start: sStart, end: sEnd } = getShiftBoundaryMoments(attendance.date, shift);
      if (punch.inTime) {
        const inM = moment(punch.inTime, "HH:mm");
        punch.lateMinutes = Math.max(0, inM.diff(sStart, "minutes"));
        punch.lateMark = punch.lateMinutes >= LATE_THRESHOLD_MIN;
      }
      if (punch.inTime && punch.outTime) {
        const inM = moment(punch.inTime, "HH:mm");
        const outM = moment(punch.outTime, "HH:mm");
        let duration = outM.diff(inM, "minutes");
        if (duration < 0) duration = 0;
        punch.durationInMinutes = duration;

        punch.overtimeMinutes = Math.max(0, outM.diff(sEnd, "minutes"));
        punch.overtimeMark = punch.overtimeMinutes >= OVERTIME_THRESHOLD_MIN;
      }
    }

    await attendance.save();
    res.status(200).json({ message: "Punch updated", attendance });
  } catch (err) {
    console.error("editPunchTimes error:", err);
    res.status(500).json({ message: "Server error" });
  }
};



/**
 * Admin: get full history for a particular employee
 */
export const getEmployeeHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const records = await Attendance.find({ user: userId }).populate(
      "user",
      "fullName email phoneNumber address salary shiftTimings"
    );
    res.status(200).json({ userId, history: records });
  } catch (err) {
    console.error("getEmployeeHistory error:", err);
    res.status(500).json({ message: "Server error" });
  }
};