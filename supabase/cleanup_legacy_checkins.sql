delete from storage.objects
where bucket_id = 'checkin-photos'
  and (storage.foldername(name))[1] = 'activity-checkins'
  and coalesce((storage.foldername(name))[2], '') !~ '^uploader_[a-zA-Z0-9_.-]{8,120}$';

delete from public.activity_checkins
where owner_id is null
   or owner_id = '';
