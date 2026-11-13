// Every appointment reserves whole half hours: 3–30 min → 30, 60 → 60, 75 → 90, 90 → 90.
// So an hour-long service can be booked at 10:00 and again at 11:00.
globalThis.CryoSchedule = Object.freeze({
  blockedMinutes(duration) {
    const minutes = Number(duration) || 30;
    return Math.max(30, Math.ceil(minutes / 30) * 30);
  },
  overlaps(start, end, otherStart, otherEnd) {
    return start < otherEnd && end > otherStart;
  },
});
