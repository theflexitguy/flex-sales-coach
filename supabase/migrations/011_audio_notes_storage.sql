-- Storage policies for audio-notes bucket (voice note coaching responses)

-- Make bucket public so getPublicUrl returns accessible URLs
UPDATE storage.buckets SET public = true WHERE id = 'audio-notes';

-- Allow authenticated users to upload voice notes
CREATE POLICY audio_notes_upload ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'audio-notes' AND auth.role() = 'authenticated');

-- Allow authenticated users to read voice notes
CREATE POLICY audio_notes_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'audio-notes' AND auth.role() = 'authenticated');
