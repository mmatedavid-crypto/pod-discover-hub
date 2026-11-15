# person-relevance-openai-batch rules

- Primary person batch claims read eligible pairs from `person_openai_batch_candidate_pool` (refreshed hourly by `refresh_person_openai_batch_candidate_pool_v1` via pg_cron) and re-check pending/decided/manual/lease/language live per pair, and ask for at most 1,000 pairs per claim call; never sort the full pending mention set inside a request, because that exceeded the 8s request timeout and aborted batches, and the API returns ≤1,000 rows so larger claims leased pairs that were never sent.
