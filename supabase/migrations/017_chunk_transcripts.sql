-- Store the Deepgram transcript per-chunk so the split route can stitch
-- pre-transcribed audio without re-sending multi-hour files to Deepgram
-- on every split invocation. This is the Phase 4 change that keeps the
-- split function inside its execution budget for long recordings.
--
-- transcript_json holds the trimmed Deepgram response we actually use:
--   { words: [{ word, start, end, confidence, speaker, punctuated_word }], request_id: string }
-- Times are RELATIVE to the chunk start, so split must add the chunk's
-- cumulative offset before treating them as session-global timestamps.

alter table session_chunks
  add column if not exists transcript_json jsonb,
  add column if not exists transcribed_at timestamptz,
  add column if not exists transcribe_error text;

create index if not exists idx_session_chunks_untranscribed
  on session_chunks (session_id, chunk_index)
  where transcript_json is null;

comment on column session_chunks.transcript_json is
  'Deepgram word-level transcript for this chunk, times relative to chunk start. Null until the chunk has been transcribed.';

comment on column session_chunks.transcribed_at is
  'Timestamp when the chunk was successfully transcribed. Used to detect chunks that never got transcribed so the split pipeline can re-drive them.';

comment on column session_chunks.transcribe_error is
  'Error message from the last transcription attempt. Null on success.';
