-- Allow authenticated users to upload and read recording chunks directly
-- (bypasses Vercel function body size limit)

CREATE POLICY recording_chunks_upload ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'recording-chunks' AND auth.role() = 'authenticated');

CREATE POLICY recording_chunks_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'recording-chunks' AND auth.role() = 'authenticated');
