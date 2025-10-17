const Attendance = require("../models/Attendance");
const User = require("../models/User");
const moment = require("moment");

/**
 * Helper: choose shift based on current time or fallback
 */
function getMatchingShift(user, timeNow) {
  return user.shiftTimings?.[0] || null;
}

const punchIn = async (req, res) => {
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
    if (!attendance) {
      attendance = new Attendance({ user: userId, date: today, punches: [] });
    }

    const lastPunch = attendance.punches[attendance.punches.length - 1];
    if (lastPunch && !lastPunch.outTime) {
      return res.status(400).json({ message: "Already punched in, please punch out first" });
    }

    const scheduledStart = moment(shift.start, "HH:mm");
    const late = timeNow.isAfter(scheduledStart);

    attendance.punches.push({
      inTime: timeNow.format("HH:mm"),
      inPhotoUrl: file.path,
      late,
    });

    await attendance.save();
    res.status(200).json({ message: "Punched in", attendance });
  } catch (err) {
    console.error("punchIn error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const punchOut = async (req, res) => {
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

    const scheduledEnd = moment(shift.end, "HH:mm");
    lastPunch.overtime = timeNow.isAfter(scheduledEnd);

    await attendance.save();
    res.status(200).json({ message: "Punched out", attendance });
  } catch (err) {
    console.error("punchOut error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const getAttendance = async (req, res) => {
  const userId = req.params.userId || req.user.id;
  try {
    const records = await Attendance.find({ user: userId }).populate("user", "fullName email phoneNumber address salary shiftTimings");

    const enhanced = records.map((att) => {
      let totalMin = 0;
      att.punches.forEach(p => {
        if (p.durationInMinutes != null) {
          totalMin += p.durationInMinutes;
        } else if (p.inTime && p.outTime) {
          const inM = moment(p.inTime, "HH:mm");
          const outM = moment(p.outTime, "HH:mm");
          const diff = outM.diff(inM, "minutes");
          totalMin += diff > 0 ? diff : 0;
        }
      });
      return {
        ...att.toObject(),
        totalMinutes: totalMin,
        totalHours: (totalMin / 60).toFixed(2)
      };
    });

    res.status(200).json({ attendance: enhanced });
  } catch (err) {
    console.error("getAttendance error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const getAttendanceByDate = async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const records = await Attendance.find({ date }).populate("user", "fullName email phoneNumber address salary shiftTimings");

    const enhanced = records.map((att) => {
      let totalMin = 0;
      const enhancedPunches = att.punches.map((punch) => {
        let duration = punch.durationInMinutes;

        if (duration == null && punch.inTime && punch.outTime) {
          const inM = moment(punch.inTime, "HH:mm");
          const outM = moment(punch.outTime, "HH:mm");
          duration = outM.diff(inM, "minutes");
          if (duration < 0) duration = 0;
        }

        if (duration != null) totalMin += duration;

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
      };
    });

    res.status(200).json({ date, attendance: enhanced });
  } catch (err) {
    console.error("getAttendanceByDate error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const getEmployeeHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const records = await Attendance.find({ user: userId }).populate("user", "fullName email phoneNumber address salary shiftTimings");
    res.status(200).json({ userId, history: records });
  } catch (err) {
    console.error("getEmployeeHistory error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

const editPunchTimes = async (req, res) => {
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

const getAttendanceByMonth = async (req, res) => {
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
    let totalMinAll = 0;

    const enhanced = records.map((att) => {
      let dayMin = 0;
      att.punches.forEach((p) => {
        if (p.durationInMinutes != null) {
          dayMin += p.durationInMinutes;
        } else if (p.inTime && p.outTime) {
          const inM = moment(p.inTime, "HH:mm");
          const outM = moment(p.outTime, "HH:mm");
          const diff = outM.diff(inM, "minutes");
          dayMin += diff > 0 ? diff : 0;
        }
      });
      totalMinAll += dayMin;
      return {
        ...att.toObject(),
        dayMinutes: dayMin,
        dayHours: (dayMin / 60).toFixed(2),
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
      },
    });
  } catch (err) {
    console.error("getAttendanceByMonth error:", err);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
  punchIn,
  punchOut,
  getAttendance,
  getAttendanceByDate,
  getEmployeeHistory,
  editPunchTimes,
  getAttendanceByMonth,
};
