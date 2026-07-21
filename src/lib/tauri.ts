import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityTypeDto,
  DayBucket,
  MonthBucket,
  ProjectDto,
  SegmentDto,
  TrackingState,
} from "./types";

export function getCurrentState() {
  return invoke<TrackingState>("get_current_state");
}

export function listProjects() {
  return invoke<ProjectDto[]>("list_projects");
}

export function listActivityTypes() {
  return invoke<ActivityTypeDto[]>("list_activity_types");
}

export function setActiveProject(projectId: number | null) {
  return invoke<TrackingState>("set_active_project", { projectId });
}

export function setActiveActivity(activityTypeId: number | null) {
  return invoke<TrackingState>("set_active_activity", { activityTypeId });
}

export function pauseTracking() {
  return invoke<TrackingState>("pause_tracking");
}

export function resumeTracking() {
  return invoke<TrackingState>("resume_tracking");
}

export function openHomeWindow() {
  return invoke<void>("open_home_window");
}

export function quitApp() {
  return invoke<void>("quit_app");
}

export type WidgetHover = { inside: boolean; ctrl: boolean };

export function pollWidgetHover() {
  return invoke<WidgetHover>("poll_widget_hover");
}

export function setAutostart(enabled: boolean) {
  return invoke<boolean>("set_autostart", { enabled });
}

export function getAutostartStatus() {
  return invoke<boolean>("get_autostart_status");
}

export function resetAllData() {
  return invoke<TrackingState>("reset_all_data");
}

export function revealExtensionFolder() {
  return invoke<string>("reveal_extension_folder");
}

export type CompanyDto = { name: string; aliases: string[] };

export function getCompany() {
  return invoke<CompanyDto>("get_company");
}

export function setCompany(name: string, aliases: string[]) {
  return invoke<CompanyDto>("set_company", { name, aliases });
}

export function getDailySummary(from: string, to: string) {
  return invoke<DayBucket[]>("get_daily_summary", { from, to });
}

export function getMonthlySummary(from: string, to: string) {
  return invoke<MonthBucket[]>("get_monthly_summary", { from, to });
}

export function getDayDetail(date: string) {
  return invoke<SegmentDto[]>("get_day_detail", { date });
}

export function confirmPendingSuggestion() {
  return invoke<TrackingState>("confirm_pending_suggestion");
}

export function denyPendingSuggestion() {
  return invoke<TrackingState>("deny_pending_suggestion");
}

export function getConfirmShortcut() {
  return invoke<string>("get_confirm_shortcut");
}

export function setConfirmShortcut(shortcut: string) {
  return invoke<string>("set_confirm_shortcut", { shortcut });
}

export function getIdleLock() {
  return invoke<boolean>("get_idle_lock");
}

export function setIdleLock(enabled: boolean) {
  return invoke<TrackingState>("set_idle_lock", { enabled });
}

export function getIdleTimeout() {
  return invoke<number>("get_idle_timeout");
}

export function setIdleTimeout(seconds: number) {
  return invoke<number>("set_idle_timeout", { seconds });
}

export function getLockShortcut() {
  return invoke<string>("get_lock_shortcut");
}

export function setLockShortcut(shortcut: string) {
  return invoke<string>("set_lock_shortcut", { shortcut });
}

export function getActivityDetectionEnabled() {
  return invoke<boolean>("get_activity_detection_enabled");
}

export function setActivityDetectionEnabled(enabled: boolean) {
  return invoke<boolean>("set_activity_detection_enabled", { enabled });
}

export function createProject(name: string, color: string | null) {
  return invoke<ProjectDto>("create_project", { name, color });
}

export function updateProject(id: number, name: string, color: string | null) {
  return invoke<void>("update_project", { id, name, color });
}

export function archiveProject(id: number) {
  return invoke<void>("archive_project", { id });
}

export function reorderProjects(orderedIds: number[]) {
  return invoke<void>("reorder_projects", { orderedIds });
}

export function setProjectAliases(projectId: number, aliases: string[]) {
  return invoke<void>("set_project_aliases", { projectId, aliases });
}

export function setProjectColors(colors: { id: number; color: string }[]) {
  return invoke<void>("set_project_colors", { colors });
}

export function saveReportPdf(path: string, contents: number[]) {
  return invoke<void>("save_report_pdf", { path, contents });
}
