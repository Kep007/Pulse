export type ProjectDto = {
  id: number;
  slug: string;
  name: string;
  color: string | null;
  aliases: string[];
};

export type ActivityTypeDto = {
  id: number;
  slug: string;
  name: string;
  color: string | null;
};

export type Source = "auto" | "manual";

export type PendingSuggestion = {
  project: ProjectDto | null;
  activityType: ActivityTypeDto | null;
};

export type TrackingState = {
  project: ProjectDto | null;
  activityType: ActivityTypeDto | null;
  source: Source;
  isPaused: boolean;
  isIdle: boolean;
  isIdleLocked: boolean;
  segmentStartedAt: string;
  todaySecondsBeforeSegment: number;
  pending: PendingSuggestion | null;
  resumeOffer: ResumeOffer | null;
  breakPrompt: BreakPrompt | null;
};

export type ResumeOffer = {
  project: ProjectDto | null;
  activityType: ActivityTypeDto | null;
  since: string;
};

export type BreakPrompt = {
  endsAt: string;
};

export type BreakDay = {
  enabled: boolean;
  start: string;
  end: string;
};

/** `days` always has 7 entries, Monday first. */
export type BreakSchedule = {
  enabled: boolean;
  days: BreakDay[];
};

export type ToastMessage = {
  text: string;
};

export type BreakdownEntry = {
  id: number;
  name: string;
  color: string | null;
  seconds: number;
};

export type DayBucket = {
  date: string;
  totalSeconds: number;
  byProject: BreakdownEntry[];
  byActivity: BreakdownEntry[];
};

export type MonthBucket = {
  month: string;
  totalSeconds: number;
  byProject: BreakdownEntry[];
  byActivity: BreakdownEntry[];
};

export type SegmentDto = {
  id: number;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  project: ProjectDto | null;
  activityType: ActivityTypeDto | null;
};

export type BreakdownMetric = "project" | "activity";

export type DayRecap = {
  totalSeconds: number;
  projects: BreakdownEntry[];
};

export type DayRecapSettings = {
  enabled: boolean;
  /** "HH:MM", local time. */
  time: string;
};

export type FocusTotals = {
  trackedSeconds: number;
  deepWorkSeconds: number;
  sessions: number;
  shortSessions: number;
  switches: number;
};

export type ProjectFocus = {
  id: number;
  name: string;
  color: string | null;
  totals: FocusTotals;
};

export type FocusStats = {
  days: number;
  overall: FocusTotals;
  projects: ProjectFocus[];
};
