// controllers/attendance.controller.js
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import moment from "moment";

// Thresholds
const LATE_THRESHOLD_MIN = 15;
const OVERTIME_THRESHOLD_MIN = 30;

// Build shift start/end with date and handle overnight end < start
function getShiftBoundaryMoments(dateStr, shift) {
  const start = moment(`${dateStr} ${shift.start}`, "YYYY-MM-DD HH:mm");
  let end = moment(`${dateStr} ${shift.end}`, "YYYY-MM-DD HH:mm");
  if (end.isBefore(start)) end.add(1, "day");
  return { start, end };
}

// Build a moment from a date string (YYYY-MM-DD) and a time string (HH:mm)
function atDateTime(dateStr, timeStr) {
  return moment(`${dateStr} ${timeStr}`, "YYYY-MM-DD HH:mm");
}

// Duration between two HH:mm times on a given date; if out < in, roll out +1 day (overnight)
function durationMinutesOnDate(dateStr, inTime, outTime) {
  if (!inTime || !outTime) return null;
  const inM = atDateTime(dateStr, inTime);
  let outM = atDateTime(dateStr, outTime);
  if (outM.isBefore(inM)) outM.add(1, "day");
  const diff = outM.diff(inM, "minutes");
  return diff >= 0 ? diff : 0;
}

/**
 * Helper: choose shift based on current time or fallback
 */
function getMatchingShift(user, timeNow) {
  return user.shiftTimings?.[0] || null;
}

// PUNCH IN with late computation (mark at >=15; sum only if >15)
export const punchIn = async (req, res) => {
  const userId = req.user.id;
  const file = req.file;
  if (!file) return res.status(400).json({ message: "Photo is required" });

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const timeNow = moment.utc().add(5, "hours").add(30, "minutes");
    const today = timeNow.clone().format("YYYY-MM-DD");

    const shift = getMatchingShift(user, timeNow);
    if (!shift) {
      return res.status(400).json({ message: "No shift defined" });
    }

    let attendance = await Attendance.findOne({ user: userId, date: today });
    if (!attendance) {
      attendance = new Attendance({ user: userId, date: today, punches: [] });
    }

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
      late: lateMark,
      lateMinutes,
      lateMark,
    });

    await attendance.save();
    return res.status(200).json({ message: "Punched in", attendance });
  } catch (err) {
    console.error("punchIn error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUNCH OUT with overtime computation (mark and sum only when >30)
export const punchOut = async (req, res) => {
  const userId = req.user.id;
  const file = req.file;
  if (!file) return res.status(400).json({ message: "Photo is required" });

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const timeNow = moment.utc().add(5, "hours").add(30, "minutes");
    const today = timeNow.clone().format("YYYY-MM-DD");

    const shift = getMatchingShift(user, timeNow);
    if (!shift) {
      return res.status(400).json({ message: "No shift defined" });
    }

    const attendance = await Attendance.findOne({ user: userId, date: today });
    if (!attendance)
      return res.status(400).json({ message: "No punch in found for today" });

    const lastPunch = attendance.punches[attendance.punches.length - 1];
    if (!lastPunch || lastPunch.outTime) {
      return res.status(400).json({ message: "No open punch to close" });
    }

    lastPunch.outTime = timeNow.format("HH:mm");
    lastPunch.outPhotoUrl = file.path;

    const duration = durationMinutesOnDate(today, lastPunch.inTime, lastPunch.outTime);
    lastPunch.durationInMinutes = duration ?? 0;

    const { end: scheduledEnd } = getShiftBoundaryMoments(today, shift);
    const overtimeMinutes = Math.max(0, timeNow.diff(scheduledEnd, "minutes"));
    const overtimeMark = overtimeMinutes > OVERTIME_THRESHOLD_MIN;

    lastPunch.overtime = overtimeMark;
    lastPunch.overtimeMinutes = overtimeMinutes;
    lastPunch.overtimeMark = overtimeMark;

    await attendance.save();
    return res.status(200).json({ message: "Punched out", attendance });
  } catch (err) {
    console.error("punchOut error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET per-user: totalMinutes excludes overtime > 30
export const getAttendance = async (req, res) => {
  const userId = req.params.userId || req.user.id;
  try {
    const records = await Attendance.find({ user: userId }).populate(
      "user",
      "fullName email phoneNumber address salary shiftTimings"
    );

    const enhanced = records.map((att) => {
      let totalMin = 0;
      let lateMin = 0;
      let overtimeMin = 0;

      const shift = att.user?.shiftTimings?.[0] || null;
      const { start: sStart, end: sEnd } = shift
        ? getShiftBoundaryMoments(att.date, shift)
        : { start: null, end: null };

      att.punches.forEach((p, idx) => {
        // Raw duration
        const d = p.durationInMinutes != null
          ? Math.max(0, p.durationInMinutes)
          : durationMinutesOnDate(att.date, p.inTime, p.outTime);

        // Overtime minutes for this punch
        const computedOT = p.overtimeMinutes != null
          ? p.overtimeMinutes
          : (sEnd && p.outTime ? Math.max(0, atDateTime(att.date, p.outTime).diff(sEnd, "minutes")) : 0);

        // Only count overtime minutes if > 30
        const countedOT = computedOT > OVERTIME_THRESHOLD_MIN ? computedOT : 0;
        overtimeMin += countedOT;

        // Subtract overtime from worked hours
        const workedMinutes = d != null ? Math.max(0, d - countedOT) : 0;
        totalMin += workedMinutes;

        // Late (first punch only)
        if (idx === 0) {
          const computedLate = p.lateMinutes != null
            ? p.lateMinutes
            : (sStart && p.inTime ? Math.max(0, atDateTime(att.date, p.inTime).diff(sStart, "minutes")) : 0);
          if (computedLate > LATE_THRESHOLD_MIN) lateMin += computedLate;
        }
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

    return res.status(200).json({ attendance: enhanced });
  } catch (err) {
    console.error("getAttendance error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Admin: get attendance by date; totalMinutes excludes overtime > 30
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

      const shift = att.user?.shiftTimings?.[0] || null;
      const { start: sStart, end: sEnd } = shift
        ? getShiftBoundaryMoments(att.date, shift)
        : { start: null, end: null };

      const enhancedPunches = att.punches.map((punch, idx) => {
        // Raw duration
        let duration = punch.durationInMinutes;
        if (duration == null) {
          const d = durationMinutesOnDate(att.date, punch.inTime, punch.outTime);
          duration = d != null ? d : 0;
        }

        // Late minutes
        let lateMinutes = punch.lateMinutes != null
          ? punch.lateMinutes
          : (sStart && punch.inTime ? Math.max(0, atDateTime(att.date, punch.inTime).diff(sStart, "minutes")) : 0);
        const lateMark = lateMinutes >= LATE_THRESHOLD_MIN;
        if (idx === 0 && lateMinutes > LATE_THRESHOLD_MIN) {
          lateMin += lateMinutes;
        }

        // Overtime minutes
        let overtimeMinutes = punch.overtimeMinutes != null
          ? punch.overtimeMinutes
          : (sEnd && punch.outTime ? Math.max(0, atDateTime(att.date, punch.outTime).diff(sEnd, "minutes")) : 0);
        const overtimeMark = overtimeMinutes > OVERTIME_THRESHOLD_MIN;

        const countedOT = overtimeMinutes > OVERTIME_THRESHOLD_MIN ? overtimeMinutes : 0;
        if (countedOT > 0) overtimeMin += countedOT;

        // Subtract overtime from worked minutes
        const workedMinutes = Math.max(0, duration - countedOT);
        totalMin += workedMinutes;

        return {
          ...punch.toObject(),
          durationInMinutes: duration,
          lateMark,
          lateMinutes,
          overtimeMark,
          overtimeMinutes,
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

    return res.status(200).json({ date, attendance: enhanced });
  } catch (err) {
    console.error("getAttendanceByDate error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Admin: employee history (no totals, just raw records)
export const getEmployeeHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const records = await Attendance.find({ user: userId }).populate(
      "user",
      "fullName email phoneNumber address salary shiftTimings"
    );
    return res.status(200).json({ userId, history: records });
  } catch (err) {
    console.error("getEmployeeHistory error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Admin: edit punch times
export const editPunchTimes = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { punchIndex, inTime, outTime } = req.body;

    const attendance = await Attendance.findById(attendanceId);
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const punch = attendance.punches[punchIndex];
    if (!punch) {
      return res.status(400).json({ message: "Invalid punch index" });
    }

    if (inTime !== undefined && inTime !== "") punch.inTime = inTime;
    if (outTime !== undefined && outTime !== "") punch.outTime = outTime;

    await attendance.save();
    return res.status(200).json({ message: "Punch updated", attendance });
  } catch (err) {
    console.error("editPunchTimes error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Monthly: day totals and summary exclude overtime > 30 from worked minutes
export const getAttendanceByMonth = async (req, res) => {
  try {
    const { userId } = req.params;
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ message: "Month is required, format YYYY-MM" });
    }

    const records = await Attendance.find({
      user: userId,
      date: { $regex: `^${month}` },
    })
      .sort({ date: 1 })
      .populate(
        "user",
        "fullName email phoneNumber address salary shiftTimings"
      );

    if (!records.length) {
      return res.status(404).json({ message: "No attendance records found" });
    }

    const user = records[0].user;

    let totalMinAll = 0;
    let totalLateAll = 0;
    let totalOvertimeAll = 0;

    const enhanced = records.map((att) => {
      let dayMin = 0;
      let dayLate = 0;
      let dayOT = 0;

      const shift = att.user?.shiftTimings?.[0] || null;
      const { start: sStart, end: sEnd } = shift
        ? getShiftBoundaryMoments(att.date, shift)
        : { start: null, end: null };

      att.punches.forEach((p, idx) => {
        // Raw duration
        const d = p.durationInMinutes != null
          ? Math.max(0, p.durationInMinutes)
          : durationMinutesOnDate(att.date, p.inTime, p.outTime);

        // Overtime
        const om = p.overtimeMinutes != null
          ? p.overtimeMinutes
          : (sEnd && p.outTime ? Math.max(0, atDateTime(att.date, p.outTime).diff(sEnd, "minutes")) : 0);

        const countedOT = om > OVERTIME_THRESHOLD_MIN ? om : 0;
        if (countedOT > 0) dayOT += countedOT;

        // Subtract overtime from worked minutes
        const workedMinutes = d != null ? Math.max(0, d - countedOT) : 0;
        dayMin += workedMinutes;

        // Late (first punch)
        if (idx === 0) {
          const lm = p.lateMinutes != null
            ? p.lateMinutes
            : (sStart && p.inTime ? Math.max(0, atDateTime(att.date, p.inTime).diff(sStart, "minutes")) : 0);
          if (lm > LATE_THRESHOLD_MIN) dayLate += lm;
        }
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

    return res.status(200).json({
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
    return res.status(500).json({ message: "Server error" });
  }
};
