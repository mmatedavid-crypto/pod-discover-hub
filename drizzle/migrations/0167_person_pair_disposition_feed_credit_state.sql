ALTER TABLE public.person_pair_dispositions DROP CONSTRAINT IF EXISTS person_pair_dispositions_disposition_check;
ALTER TABLE public.person_pair_dispositions ADD CONSTRAINT person_pair_dispositions_disposition_check CHECK (disposition = ANY (ARRAY[
  'decided_accepted','decided_rejected','first_round_pending','in_progress','technical_retry','source_needed','insufficient_evidence',
  'evidence_pending','human_identity_review','human_contradiction_review','other','resolved_show_host','resolved_feed_credit_not_episode']::text[]));