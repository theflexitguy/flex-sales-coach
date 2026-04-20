-- Link each persona to its ElevenLabs Conversational AI agent.
-- Populated lazily on first session (or via explicit sync endpoint).
alter table roleplay_personas
  add column if not exists elevenlabs_agent_id text;

comment on column roleplay_personas.elevenlabs_agent_id is
  'ElevenLabs Conversational AI agent ID; created lazily on first session start.';
