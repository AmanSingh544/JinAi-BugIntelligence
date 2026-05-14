export class UpdateEnvironmentDto {
  sampling_click?: number;
  sampling_navigation?: number;
  sampling_console?: number;
  sampling_api?: number;
  sampling_error?: number;
  replay_enabled?: boolean;
  screenshot_on_error?: boolean;
  retention_events_days?: number;
  retention_sessions_days?: number;
  retention_replay_days?: number;
  retention_screenshots_days?: number;
  retention_bug_detail_days?: number;
  retention_dlq_days?: number;
}
