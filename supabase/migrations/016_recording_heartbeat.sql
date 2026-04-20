-- Track a session's last heartbeat so we can detect killed apps / dead
-- recorders whose audio never got finalized. The mobile client pings a
-- /api/sessions/heartbeat endpoint every ~60s while recording. A session
-- stuck in 'recording' or 'processing' with a stale heartbeat is a
-- candidate for auto-recovery.
alter table recording_sessions
  add column if not exists last_heartbeat_at timestamptz;

comment on column recording_sessions.last_heartbeat_at is
  'Updated every ~60s by the mobile client while recording. Used to detect sessions whose app was killed or went silently dead.';

create index if not exists idx_recording_sessions_status_heartbeat
  on recording_sessions (status, last_heartbeat_at)
  where status in ('recording', 'uploading', 'processing');
