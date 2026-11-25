export type ScheduledWorkflowTrigger = {
    type?: string;
    projectId?: string;
    cadence?: "DAILY" | "WEEKLY";
    weekdayUtc?: number;
    hourUtc?: number;
    minuteUtc?: number;
};
export declare function scheduledWorkflowSlot(trigger: ScheduledWorkflowTrigger, now: Date): Date | null;
