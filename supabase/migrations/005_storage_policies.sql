-- =============================================================
-- Migration 005: Storage — trip-evidence bucket setup
--
-- Run this AFTER creating the bucket in the Supabase Dashboard:
-- Storage → New Bucket → Name: "trip-evidence" → Public: OFF
-- =============================================================

-- -----------------------------------------------
-- Storage RLS Policies for trip-evidence bucket
-- -----------------------------------------------

-- Allow authenticated users to upload files only under their own UUID prefix
create policy "trip-evidence: authenticated upload own path"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'trip-evidence'
    -- Path format: {uploader_uuid}/{trip_uuid}/{filename}
    -- Verify that the first segment of the path matches the uploader's UID
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow users to read only their own uploaded files; admins read any
create policy "trip-evidence: authenticated read own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'trip-evidence'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- No delete for regular authenticated users — evidence is immutable
-- Only service_role (via admin operations) can delete

-- -----------------------------------------------
-- Notes:
-- The bucket itself must be created manually in the Supabase Dashboard
-- OR via the Supabase CLI:
--   supabase storage create trip-evidence --no-public
-- -----------------------------------------------
