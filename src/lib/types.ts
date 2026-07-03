export type ProjectDto = {
  id: number;
  slug: string;
  name: string;
  color: string | null;
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
  segmentStartedAt: string;
  pending: PendingSuggestion | null;
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
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  project: ProjectDto | null;
  activityType: ActivityTypeDto | null;
};

export type BreakdownMetric = "project" | "activity";
