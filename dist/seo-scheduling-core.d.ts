export type Recurrence = {
    frequency: "ONCE";
    at: string;
} | {
    frequency: "DAILY";
    hour: number;
    minute: number;
    startAt?: string;
    endAt?: string;
} | {
    frequency: "WEEKLY";
    hour: number;
    minute: number;
    weekdays: number[];
    startAt?: string;
    endAt?: string;
} | {
    frequency: "MONTHLY";
    hour: number;
    minute: number;
    dayOfMonth: number;
    startAt?: string;
    endAt?: string;
};
/** Returns the next schedule occurrence strictly after `after`, in the schedule's IANA timezone. */
export declare function nextSeoOccurrence(after: Date, timezone: string, recurrence: Recurrence): Date | null;
export declare function scheduleOccurrenceKey(scheduleId: string, scheduledAt: Date): string;
export declare function seoOccurrencesBetween(from: Date, to: Date, timezone: string, recurrence: Recurrence, limit?: number): Date[];
