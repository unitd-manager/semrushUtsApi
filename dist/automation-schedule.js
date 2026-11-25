export function scheduledWorkflowSlot(trigger, now) {
    if (trigger.type !== "schedule" || !trigger.projectId || !["DAILY", "WEEKLY"].includes(trigger.cadence ?? ""))
        return null;
    const hour = trigger.hourUtc;
    const minute = trigger.minuteUtc;
    const weekday = trigger.weekdayUtc;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
        return null;
    if (trigger.cadence === "WEEKLY" && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6))
        return null;
    const slot = new Date(now);
    slot.setUTCHours(hour, minute, 0, 0);
    if (trigger.cadence === "WEEKLY")
        slot.setUTCDate(slot.getUTCDate() - ((now.getUTCDay() - weekday + 7) % 7));
    return slot <= now ? slot : null;
}
