DELETE FROM public.podcasts
 WHERE source = 'queue_drainer'
   AND title IN ('Phase4a Test Podcast 1', 'Phase4a Test Podcast 2', 'Phase4a Test Podcast 3');