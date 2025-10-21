// utils/attendanceTime.js
import moment from "moment";

export const LATE_THRESHOLD_MIN = 15;
export const OVERTIME_THRESHOLD_MIN = 30;

export function getShiftBoundaryMoments(dateStr, shift) {
  const start = moment(`${dateStr} ${shift.start}`, "YYYY-MM-DD HH:mm");
  let end = moment(`${dateStr} ${shift.end}`, "YYYY-MM-DD HH:mm");
  if (end.isBefore(start)) end.add(1, "day");
  return { start, end };
}
