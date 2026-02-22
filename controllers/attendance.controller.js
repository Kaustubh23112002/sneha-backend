// controllers/attendance.controller.js
import Attendance from "../models/Attendance.js";
import User from "../models/User.js";
import moment from "moment";

// Thresholds
const LATE_THRESHOLD_MIN = 15;

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

// Calculate scheduled shift duration
function getScheduledShiftMinutes(shift) {
  if (!shift || !shift.start || !shift.end) return 0;
  const start = moment(shift.start, "HH:mm");
  let end = moment(shift.end, "HH:mm");
  if (end.isBefore(start)) end.add(1, "day");
  return end.diff(start, "minutes");
}

// Helper: choose shift
function getMatchingShift(user, timeNow) {
  return user.shiftTimings?.[0] || null;
}

// PUNCH IN with late computation (mark at >=15) and monthly late mark tracking
export const punchIn = async (req, res) => {
  const userId = req.user.id;
  const file = req.file;
  if (!file) return res.status(400).json({ message: "Photo is required" });

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const timeNow = moment.utc().add(5, "hours").add(30, "minutes");
    const today = timeNow.clone().format("YYYY-MM-DD");
    const currentMonth = timeNow.format("YYYY-MM");

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

    // **Count late marks in CURRENT MONTH ONLY (auto-resets each month)**
    let currentMonthLateMarks = 0;
    if (lateMark) {
      const monthStart = moment(currentMonth, "YYYY-MM").startOf("month").format("YYYY-MM-DD");
      const monthEnd = moment(currentMonth, "YYYY-MM").endOf("month").format("YYYY-MM-DD");

      const monthlyLateCount = await Attendance.aggregate([
        {
          $match: {
            user: user._id,
            date: { $gte: monthStart, $lte: monthEnd },
          },
        },
        {
          $unwind: "$punches",
        },
        {
          $match: {
            "punches.lateMark": true,
          },
        },
        {
          $count: "lateMarks",
        },
      ]);

      currentMonthLateMarks = monthlyLateCount[0]?.lateMarks || 0;
    }

    // **Determine if this late mark triggers half-day deduction**
    const willBeHalfDay = lateMark && (currentMonthLateMarks + 1) % 3 === 0;

    attendance.punches.push({
      inTime: timeNow.format("HH:mm"),
      inPhotoUrl: file.path,
      late: lateMark,
      lateMinutes,
      lateMark,
    });

    await attendance.save();

    const responseMsg = lateMark
      ? `Punched in (Late by ${lateMinutes} minutes)${
          willBeHalfDay ? " - Half day deduction will be applied!" : ""
        }. This is late mark ${currentMonthLateMarks + 1} this month.`
      : "Punched in successfully";

    return res.status(200).json({
      message: responseMsg,
      attendance,
      isLate: lateMark,
      lateMinutes,
      currentMonthLateMarks: currentMonthLateMarks + (lateMark ? 1 : 0),
      halfDayTriggered: willBeHalfDay,
    });
  } catch (err) {
    console.error("punchIn error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUNCH OUT (no overtime, cap at shift duration)
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

    await attendance.save();
    return res.status(200).json({ message: "Punched out", attendance });
  } catch (err) {
    console.error("punchOut error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET per-user: totalMinutes capped at shift duration, ignore early arrival
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

      const shift = att.user?.shiftTimings?.[0] || null;
      const { start: sStart, end: sEnd } = shift
        ? getShiftBoundaryMoments(att.date, shift)
        : { start: null, end: null };

      const scheduledShiftMinutes = shift ? getScheduledShiftMinutes(shift) : 0;

      att.punches.forEach((p, idx) => {
        // Raw duration from in to out
        const rawDuration =
          p.inTime && p.outTime
            ? durationMinutesOnDate(att.date, p.inTime, p.outTime)
            : p.durationInMinutes ?? 0;

        // Effective start: max(inTime, shift.start) - ignore early arrival
        const actualIn = p.inTime ? atDateTime(att.date, p.inTime) : null;
        const effectiveStart = actualIn && sStart ? moment.max(actualIn, sStart) : actualIn;

        // Effective end: min(outTime, shift.end) - cap at shift end
        const actualOut = p.outTime ? atDateTime(att.date, p.outTime) : null;
        let effectiveEnd = actualOut && sEnd ? moment.min(actualOut, sEnd) : actualOut;

        // Handle overnight effective end
        if (effectiveEnd && effectiveStart && effectiveEnd.isBefore(effectiveStart)) {
          effectiveEnd.add(1, "day");
        }

        // Calculate worked minutes (capped at shift duration, no early/overtime)
        let workedMinutes = 0;
        if (effectiveStart && effectiveEnd) {
          workedMinutes = Math.max(0, effectiveEnd.diff(effectiveStart, "minutes"));
          // Cap at scheduled shift duration
          workedMinutes = Math.min(workedMinutes, scheduledShiftMinutes);
        }

        totalMin += workedMinutes;

        // Late only for first punch
        if (idx === 0) {
          const computedLate =
            p.inTime && sStart
              ? Math.max(0, atDateTime(att.date, p.inTime).diff(sStart, "minutes"))
              : 0;
          if (computedLate >= LATE_THRESHOLD_MIN) lateMin += computedLate;
        }
      });

      return {
        ...att.toObject(),
        totalMinutes: totalMin,
        totalHours: (totalMin / 60).toFixed(2),
        totalLateMinutes: lateMin,
        totalLateHours: (lateMin / 60).toFixed(2),
      };
    });

    return res.status(200).json({ attendance: enhanced });
  } catch (err) {
    console.error("getAttendance error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Admin: get attendance by date; totalMinutes capped, no early/overtime
export const getAttendanceByDate = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const employees = await User.find({ role: "employee" }).select(
      "fullName email phoneNumber address salary shiftTimings image"
    );

    const records = await Attendance.find({ date }).populate(
      "user",
      "fullName email phoneNumber address salary shiftTimings image"
    );

    // 🔥 Enhance attendance records FIRST
    const enhancedMap = {};

    for (const att of records) {
      let totalMin = 0;
      let lateMin = 0;

      const shift = att.user?.shiftTimings?.[0] || null;
      const { start: sStart, end: sEnd } = shift
        ? getShiftBoundaryMoments(att.date, shift)
        : { start: null, end: null };

      const scheduledShiftMinutes = shift
        ? getScheduledShiftMinutes(shift)
        : 0;

      const enhancedPunches = att.punches.map((punch, idx) => {
        const duration =
          punch.inTime && punch.outTime
            ? durationMinutesOnDate(att.date, punch.inTime, punch.outTime)
            : punch.durationInMinutes ?? 0;

        const lateMinutes =
          punch.inTime && sStart
            ? Math.max(
                0,
                atDateTime(att.date, punch.inTime).diff(sStart, "minutes")
              )
            : 0;

        if (idx === 0 && lateMinutes >= LATE_THRESHOLD_MIN) {
          lateMin += lateMinutes;
        }

        const actualIn = punch.inTime
          ? atDateTime(att.date, punch.inTime)
          : null;

        const effectiveStart =
          actualIn && sStart ? moment.max(actualIn, sStart) : actualIn;

        const actualOut = punch.outTime
          ? atDateTime(att.date, punch.outTime)
          : null;

        let effectiveEnd =
          actualOut && sEnd ? moment.min(actualOut, sEnd) : actualOut;

        if (
          effectiveEnd &&
          effectiveStart &&
          effectiveEnd.isBefore(effectiveStart)
        ) {
          effectiveEnd.add(1, "day");
        }

        let workedMinutes = 0;
        if (effectiveStart && effectiveEnd) {
          workedMinutes = Math.max(
            0,
            effectiveEnd.diff(effectiveStart, "minutes")
          );
          workedMinutes = Math.min(workedMinutes, scheduledShiftMinutes);
        }

        totalMin += workedMinutes;

        return {
          ...punch.toObject(),
          durationInMinutes: duration,
          lateMinutes,
          lateMark: lateMinutes >= LATE_THRESHOLD_MIN,
        };
      });

      enhancedMap[att.user._id.toString()] = {
        ...att.toObject(),
        punches: enhancedPunches,
        totalMinutes: totalMin,
        totalHours: (totalMin / 60).toFixed(2),
        totalLateMinutes: lateMin,
        totalLateHours: (lateMin / 60).toFixed(2),
      };
    }

    // 🔥 Now merge employees
    const merged = employees.map((emp) => {
      const existing = enhancedMap[emp._id.toString()];

      if (existing) return existing;

      return {
        _id: `no-att-${emp._id}`,
        date,
        user: emp,
        punches: [],
        totalMinutes: 0,
        totalHours: "0.00",
        totalLateMinutes: 0,
        totalLateHours: "0.00",
        isAbsent: true,
      };
    });

    return res.status(200).json({
      date,
      attendance: merged,
    });
  } catch (err) {
    console.error("getAttendanceByDate error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Admin: employee history (raw)
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

// Admin: edit punch times (recompute derived fields on write)
export const editPunchTimes = async (req, res) => {
  try {
    const { attendanceId } = req.params;
    const { punchIndex, inTime, outTime } = req.body;

    const attendance = await Attendance.findById(attendanceId).populate(
      "user",
      "shiftTimings"
    );
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    const punch = attendance.punches[punchIndex];
    if (!punch) {
      return res.status(400).json({ message: "Invalid punch index" });
    }

    if (inTime !== undefined && inTime !== "") punch.inTime = inTime;
    if (outTime !== undefined && outTime !== "") punch.outTime = outTime;

    const shift = attendance.user?.shiftTimings?.[0] || null;
    if (shift) {
      const { start: sStart } = getShiftBoundaryMoments(attendance.date, shift);

      // recompute duration
      const d =
        punch.inTime && punch.outTime
          ? durationMinutesOnDate(attendance.date, punch.inTime, punch.outTime)
          : null;
      if (d != null) punch.durationInMinutes = d;

      // recompute late (only meaningful for first punch)
      if (punchIndex === 0 && punch.inTime) {
        const lm = Math.max(0, atDateTime(attendance.date, punch.inTime).diff(sStart, "minutes"));
        punch.lateMinutes = lm;
        punch.late = lm >= LATE_THRESHOLD_MIN;
        punch.lateMark = punch.late;
      }
    }

    await attendance.save();
    return res.status(200).json({ message: "Punch updated", attendance });
  } catch (err) {
    console.error("editPunchTimes error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// Monthly: day totals capped at shift duration, late marks tracked for half-day deduction (RESETS EVERY MONTH)
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
      .populate("user", "fullName email phoneNumber address salary shiftTimings");

    if (!records.length) {
      return res.status(404).json({ message: "No attendance records found" });
    }

    const user = records[0].user;
    const shift = user?.shiftTimings?.[0] || null;
    const scheduledShiftMinutes = shift ? getScheduledShiftMinutes(shift) : 0;

    let totalMinAll = 0;
    let totalLateAll = 0;
    let lateMarkCount = 0; // **Counter resets every month automatically since we only query one month**
    let halfDayDeductions = 0;

    const enhanced = records.map((att) => {
      let dayMin = 0;
      let dayLate = 0;
      let dayHasLateMark = false;

      const { start: sStart, end: sEnd } = shift
        ? getShiftBoundaryMoments(att.date, shift)
        : { start: null, end: null };

      att.punches.forEach((p, idx) => {
        // Raw duration
        const d =
          p.inTime && p.outTime
            ? durationMinutesOnDate(att.date, p.inTime, p.outTime)
            : p.durationInMinutes ?? 0;

        // Effective start: max(inTime, shift.start)
        const actualIn = p.inTime ? atDateTime(att.date, p.inTime) : null;
        const effectiveStart = actualIn && sStart ? moment.max(actualIn, sStart) : actualIn;

        // Effective end: min(outTime, shift.end)
        const actualOut = p.outTime ? atDateTime(att.date, p.outTime) : null;
        let effectiveEnd = actualOut && sEnd ? moment.min(actualOut, sEnd) : actualOut;

        // Handle overnight
        if (effectiveEnd && effectiveStart && effectiveEnd.isBefore(effectiveStart)) {
          effectiveEnd.add(1, "day");
        }

        // Calculate worked (capped)
        let workedMinutes = 0;
        if (effectiveStart && effectiveEnd) {
          workedMinutes = Math.max(0, effectiveEnd.diff(effectiveStart, "minutes"));
          workedMinutes = Math.min(workedMinutes, scheduledShiftMinutes);
        }

        dayMin += workedMinutes;

        // Late (first punch)
        if (idx === 0) {
          const lm =
            p.inTime && sStart
              ? Math.max(0, atDateTime(att.date, p.inTime).diff(sStart, "minutes"))
              : 0;
          if (lm >= LATE_THRESHOLD_MIN) {
            dayLate += lm;
            dayHasLateMark = true;
          }
        }
      });

      // **Track late marks for THIS MONTH only (auto-resets when querying different month)**
      let isHalfDayDeducted = false;
      if (dayHasLateMark) {
        lateMarkCount++; // Increment only within this month's records
        
        // Every 3rd late mark = half day deduction
        if (lateMarkCount % 3 === 0) {
          halfDayDeductions++;
          isHalfDayDeducted = true;
          // Deduct half the scheduled shift
          dayMin = Math.max(0, dayMin - (scheduledShiftMinutes / 2));
        }
      }

      totalMinAll += dayMin;
      totalLateAll += dayLate;

      return {
        ...att.toObject(),
        dayMinutes: dayMin,
        dayHours: (dayMin / 60).toFixed(2),
        totalLateMinutes: dayLate,
        totalLateHours: (dayLate / 60).toFixed(2),
        isHalfDayDeducted,
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
        totalLateHours: (totalLateAll / 60).toFixed(2),
        lateMarkCount, // Shows count for THIS MONTH only
        halfDayDeductions,
      },
    });
  } catch (err) {
    console.error("getAttendanceByMonth error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
