// Short appointments reserve a full half hour; longer sessions keep their reset buffer.
globalThis.CryoSchedule = Object.freeze({
  blockedMinutes(duration) {
    const minutes = Number(duration) || 30;
    return minutes <= 30 ? 30 : minutes + 2;
  },
  overlaps(start, end, otherStart, otherEnd) {
    return start < otherEnd && end > otherStart;
  },
});
