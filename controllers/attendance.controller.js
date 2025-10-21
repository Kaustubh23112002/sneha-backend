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

/**
 * Helper: choose shift based on current time or fallback
 */
function getMatchingShift(user, timeNow) {
  // Just return the first shift for now (you can add logic to match time if needed)
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

    // Use IST for "now"
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
      return res
        .status(400)
        .json({ message: "Already punched in, please punch out first" });
    }

    // Compute late minutes against scheduled start for today
    const { start: scheduledStart } = getShiftBoundaryMoments(today, shift);
    const lateMinutes = Math.max(0, timeNow.diff(scheduledStart, "minutes"));
    const lateMark = lateMinutes >= LATE_THRESHOLD_MIN;

    // Keep existing 'late' field for compatibility; expose minutes for client
    attendance.punches.push({
      inTime: timeNow.format("HH:mm"),
      inPhotoUrl: file.path,
      late: lateMark,
      // exposed computed fields (included in response)
      lateMinutes,
      lateMark,
    });

    await attendance.save();
    res.status(200).json({ message: "Punched in", attendance });
  } catch (err) {
    console.error("punchIn error:", err);
    res.status(500).json({ message: "Server error" });
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

    // Use IST for "now"
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

    // Calculate duration in minutes
    const inMoment = moment(lastPunch.inTime, "HH:mm");
    const outMoment = moment(lastPunch.outTime, "HH:mm");
    let duration = outMoment.diff(inMoment, "minutes");
    if (duration < 0) duration = 0; // avoid negatives
    lastPunch.durationInMinutes = duration;

    // Compute overtime minutes against scheduled end for today (handle overnight)
    const { end: scheduledEnd } = getShiftBoundaryMoments(today, shift);
    const overtimeMinutes = Math.max(0, timeNow.diff(scheduledEnd, "minutes"));
    const overtimeMark = overtimeMinutes > OVERTIME_THRESHOLD_MIN;

    // Keep existing 'overtime' field for compatibility; expose minutes for client
    lastPunch.overtime = overtimeMark;
    lastPunch.overtimeMinutes = overtimeMinutes;
    lastPunch.overtimeMark = overtimeMark;

    await attendance.save();
    res.status(200).json({ message: "Punched out", attendance });
  } catch (err) {
    console.error("punchOut error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// GET per-user: include total late/OT minutes and hours per day
// - Count late minutes only if lateMinutes > 15 (first punch)
// - Count overtime minutes only if overtimeMinutes > 30 (all punches)
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
        // Worked minutes
        if (p.durationInMinutes != null) {
          totalMin += Math.max(0, p.durationInMinutes);
        } else if (p.inTime && p.outTime) {
          const inM = moment(p.inTime, "HH:mm");
          const outM = moment(p.outTime, "HH:mm");
          const diff = outM.diff(inM, "minutes");
          totalMin += diff > 0 ? diff : 0;
        }

        // Late minutes (first punch only) — add only if strictly > threshold
        if (idx === 0) {
          const computedLate =
            p.lateMinutes != null
              ? p.lateMinutes
              : sStart && p.inTime
              ? Math.max(0, moment(p.inTime, "HH:mm").diff(sStart, "minutes"))
              : 0;
          if (computedLate > LATE_THRESHOLD_MIN) {
            lateMin += computedLate;
          }
        }

        // Overtime minutes (all punches) — add only if strictly > threshold
        const computedOT =
          p.overtimeMinutes != null
            ? p.overtimeMinutes
            : sEnd && p.outTime
            ? Math.max(0, moment(p.outTime, "HH:mm").diff(sEnd, "minutes"))
            : 0;
        if (computedOT > OVERTIME_THRESHOLD_MIN) {
          overtimeMin += computedOT;
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

    res.status(200).json({ attendance: enhanced });
  } catch (err) {
    console.error("getAttendance error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Admin: get attendance records for a given date (or today)
 * - Count late only if >15 on first punch; OT only if >30 on each punch
 */
export const getAttendanceByDate = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
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

      // Enhance punches with calculated duration and late/OT minutes
      const enhancedPunches = att.punches.map((punch, idx) => {
        // duration
        let duration = punch.durationInMinutes;
        if (duration == null && punch.inTime && punch.outTime) {
          const inM = moment(punch.inTime, "HH:mm");
          const outM = moment(punch.outTime, "HH:mm");
          duration = outM.diff(inM, "minutes");
          if (duration < 0) duration = 0;
        }
        if (duration != null) totalMin += duration;

        // late minutes (first punch only) — include only if > threshold
        let lateMinutes =
          punch.lateMinutes != null
            ? punch.lateMinutes
            : sStart && punch.inTime
            ? Math.max(0, moment(punch.inTime, "HH:mm").diff(sStart, "minutes"))
            : 0;
        const lateMark = lateMinutes >= LATE_THRESHOLD_MIN;
        if (idx === 0 && lateMinutes > LATE_THRESHOLD_MIN) {
          lateMin += lateMinutes;
        }

        // overtime minutes (each punch) — include only if > threshold
        let overtimeMinutes =
          punch.overtimeMinutes != null
            ? punch.overtimeMinutes
            : sEnd && punch.outTime
            ? Math.max(0, moment(punch.outTime, "HH:mm").diff(sEnd, "minutes"))
            : 0;
        const overtimeMark = overtimeMinutes > OVERTIME_THRESHOLD_MIN;
        if (overtimeMinutes > OVERTIME_THRESHOLD_MIN) {
          overtimeMin += overtimeMinutes;
        }

        return {
          ...punch.toObject(),
          durationInMinutes: duration ?? 0,
          // expose computed flags + minutes in API response
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

    res.status(200).json({ date, attendance: enhanced });
  } catch (err) {
    console.error("getAttendanceByDate error:", err);
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

/**
 * Admin: edit a punch’s inTime and/or outTime
 * Note: leaves persisted booleans; recomputation/gating is in getters.
 */
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
    res.status(200).json({ message: "Punch updated", attendance });
  } catch (err) {
    console.error("editPunchTimes error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

// Monthly: include day totals and monthly rollups for late/OT with thresholds
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

    // Assuming user is the same for all records, get from first record
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
        // worked minutes
        if (p.durationInMinutes != null) {
          dayMin += Math.max(0, p.durationInMinutes);
        } else if (p.inTime && p.outTime) {
          const inM = moment(p.inTime, "HH:mm");
          const outM = moment(p.outTime, "HH:mm");
          const diff = outM.diff(inM, "minutes");
          dayMin += diff > 0 ? diff : 0;
        }

        // late (first punch) — include only if > 15
        if (idx === 0) {
          const lm =
            p.lateMinutes != null
              ? p.lateMinutes
              : sStart && p.inTime
              ? Math.max(0, moment(p.inTime, "HH:mm").diff(sStart, "minutes"))
              : 0;
          if (lm > LATE_THRESHOLD_MIN) {
            dayLate += lm;
          }
        }

        // overtime (sum across punches) — include only if > 30
        const om =
          p.overtimeMinutes != null
            ? p.overtimeMinutes
            : sEnd && p.outTime
            ? Math.max(0, moment(p.outTime, "HH:mm").diff(sEnd, "minutes"))
            : 0;
        if (om > OVERTIME_THRESHOLD_MIN) {
          dayOT += om;
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
