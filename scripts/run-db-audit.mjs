import { spawnSync } from "node:child_process";
import fs from "node:fs";

const outPath = process.argv[2] || "/private/tmp/podiverzum-db-audit.json";
if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

const queries = [
  {
    name: "table_overview",
    sql: `
      select
        c.relname,
        c.relkind,
        pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
        pg_total_relation_size(c.oid) as total_bytes,
        coalesce(s.n_live_tup, 0) as n_live_tup,
        coalesce(s.n_dead_tup, 0) as n_dead_tup,
        s.last_vacuum,
        s.last_autovacuum,
        s.last_analyze,
        s.last_autoanalyze
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public'
        and c.relkind in ('r','p','m','v')
      order by pg_total_relation_size(c.oid) desc
      limit 80
    `,
  },
  {
    name: "columns_key_tables",
    sql: `
      select table_name, column_name, data_type, udt_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name in (
          'podcasts','episodes','episode_clean_text','episode_clean_text_candidates',
          'episode_chunks','episode_embeddings','people','organizations',
          'person_episode_mentions','episode_organization_map','app_settings','queue_health_events'
        )
      order by table_name, ordinal_position
    `,
  },
  {
    name: "indexes_top",
    sql: `
      select
        t.relname as table_name,
        i.relname as index_name,
        pg_size_pretty(pg_relation_size(i.oid)) as index_size,
        pg_relation_size(i.oid) as index_bytes,
        coalesce(s.idx_scan, 0) as idx_scan,
        coalesce(s.idx_tup_read, 0) as idx_tup_read,
        pg_get_indexdef(i.oid) as index_def
      from pg_index ix
      join pg_class i on i.oid = ix.indexrelid
      join pg_class t on t.oid = ix.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      left join pg_stat_user_indexes s on s.indexrelid = i.oid
      where n.nspname = 'public'
      order by pg_relation_size(i.oid) desc
      limit 120
    `,
  },
  {
    name: "rls_tables",
    sql: `
      select
        c.relname,
        c.relrowsecurity,
        c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r','p')
      order by c.relname
    `,
  },
  {
    name: "policies",
    sql: `
      select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
      where schemaname = 'public'
      order by tablename, policyname
    `,
  },
  {
    name: "grants_public_roles",
    sql: `
      select table_name, grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon','authenticated','public','readonly_codex')
      order by table_name, grantee, privilege_type
    `,
  },
  {
    name: "foreign_keys",
    sql: `
      select
        conrelid::regclass::text as table_name,
        conname,
        confrelid::regclass::text as referenced_table,
        pg_get_constraintdef(oid) as definition
      from pg_constraint
      where contype = 'f'
        and connamespace = 'public'::regnamespace
      order by conrelid::regclass::text, conname
    `,
  },
  {
    name: "episode_quality_counts",
    sql: `
      select
        count(*) as episodes,
        count(*) filter (where published_at is null) as missing_published_at,
        count(*) filter (where published_at > now() + interval '1 day') as future_published_at,
        count(*) filter (where audio_url is null or length(trim(audio_url)) = 0) as missing_audio_url,
        count(*) filter (where description is null or length(trim(description)) = 0) as missing_description,
        count(*) filter (where summary is null or length(trim(summary)) = 0) as missing_summary,
        count(*) filter (where ai_summary is null or length(trim(ai_summary)) = 0) as missing_ai_summary,
        count(*) filter (where ai_entities_version < 4) as entities_below_v4,
        count(*) filter (where clean_text_status = 'done') as clean_done,
        count(*) filter (where clean_text_status = 'skipped') as clean_skipped,
        count(*) filter (where topic_extraction_status = 'done') as topic_done,
        count(*) filter (where topic_extraction_status = 'pending') as topic_pending,
        count(*) filter (where topic_extraction_status = 'skipped_short') as topic_skipped_short
      from public.episodes
    `,
  },
  {
    name: "clean_text_integrity",
    sql: `
      select
        count(*) as episodes,
        count(ct.episode_id) as clean_rows,
        count(*) filter (where e.clean_text_status = 'done' and ct.episode_id is null) as done_missing_clean_row,
        count(*) filter (where e.clean_text_status <> 'done' and ct.episode_id is not null) as clean_row_but_not_done,
        count(*) filter (where ct.cleaned_text is null or length(trim(ct.cleaned_text)) = 0) as empty_clean_text,
        count(*) filter (where ct.cleaned_text ~* '(https?://|www\\.|instagram|facebook|tiktok|youtube|spotify|apple podcasts|iratkozz|támogass|tamogass|kövess|kovess|hírlevél|hirlevel)') as likely_dirty_clean_text,
        percentile_disc(0.1) within group (order by length(ct.cleaned_text)) as clean_len_p10,
        percentile_disc(0.5) within group (order by length(ct.cleaned_text)) as clean_len_p50,
        percentile_disc(0.9) within group (order by length(ct.cleaned_text)) as clean_len_p90
      from public.episodes e
      left join public.episode_clean_text ct on ct.episode_id = e.id
    `,
  },
  {
    name: "embedding_integrity",
    sql: `
      select
        (select count(*) from public.episodes) as episodes,
        (select count(*) from public.episode_embeddings) as episode_embeddings,
        (select count(*) from public.episode_chunks) as episode_chunks,
        (select count(*) from public.episodes e left join public.episode_embeddings ee on ee.episode_id = e.id where ee.episode_id is null and e.clean_text_status = 'done') as clean_done_missing_embedding,
        (select count(*) from public.episode_embeddings ee left join public.episodes e on e.id = ee.episode_id where e.id is null) as orphan_episode_embeddings,
        (select count(*) from public.episode_chunks ec left join public.episodes e on e.id = ec.episode_id where e.id is null) as orphan_episode_chunks,
        (select count(*) from public.episode_chunks where embedding is null) as chunks_missing_embedding
    `,
  },
  {
    name: "entity_integrity",
    sql: `
      select
        (select count(*) from public.people) as people,
        (select count(*) from public.organizations) as organizations,
        (select count(*) from public.person_episode_mentions) as person_mentions,
        (select count(*) from public.episode_organization_map) as org_mentions,
        (select count(*) from public.person_episode_mentions pem left join public.episodes e on e.id = pem.episode_id where e.id is null) as orphan_person_mentions_episode,
        (select count(*) from public.person_episode_mentions pem left join public.people p on p.id = pem.person_id where p.id is null) as orphan_person_mentions_person,
        (select count(*) from public.episode_organization_map eom left join public.episodes e on e.id = eom.episode_id where e.id is null) as orphan_org_mentions_episode,
        (select count(*) from public.episode_organization_map eom left join public.organizations o on o.id = eom.organization_id where o.id is null) as orphan_org_mentions_org,
        (select count(*) from public.people where is_public and not is_indexable) as public_people_not_indexable,
        (select count(*) from public.organizations where is_public and not is_indexable) as public_orgs_not_indexable
    `,
  },
  {
    name: "podcast_quality_counts",
    sql: `
      select
        count(*) as podcasts,
        count(*) filter (where rss_url is null or length(trim(rss_url)) = 0) as missing_rss,
        count(*) filter (where rss_status is distinct from 'ok') as rss_not_ok,
        count(*) filter (where language not in ('hu','hu-HU') and is_hungarian is true) as non_hu_language_accepted,
        count(*) filter (where language in ('hu','hu-HU') and is_hungarian is false) as hu_language_rejected,
        count(*) filter (where shadow_rank_tier is null) as missing_shadow_tier,
        count(*) filter (where rank_label is null) as missing_rank_label,
        count(*) filter (where podiverzum_rank is null) as missing_podiverzum_rank
      from public.podcasts
    `,
  },
  {
    name: "settings_keys",
    sql: `
      select key, updated_at, left(value::text, 500) as value_preview
      from public.app_settings
      order by key
    `,
  },
  {
    name: "queue_health_events_count",
    sql: `
      select count(*) as queue_health_events, min(created_at) as first_event, max(created_at) as last_event
      from public.queue_health_events
    `,
  },
  {
    name: "top_dirty_clean_text_samples",
    sql: `
      select e.id, e.title, left(ct.cleaned_text, 700) as cleaned_text_sample
      from public.episode_clean_text ct
      join public.episodes e on e.id = ct.episode_id
      where ct.cleaned_text ~* '(https?://|www\\.|instagram|facebook|tiktok|youtube|spotify|apple podcasts|iratkozz|támogass|tamogass|kövess|kovess|hírlevél|hirlevel)'
      order by ct.updated_at desc nulls last
      limit 20
    `,
  },
  {
    name: "future_episode_samples",
    sql: `
      select id, title, published_at
      from public.episodes
      where published_at > now() + interval '1 day'
      order by published_at desc
      limit 20
    `,
  },
  {
    name: "large_duplicate_guid_counts",
    sql: `
      select guid, count(*) as c
      from public.episodes
      where guid is not null and length(trim(guid)) > 0
      group by guid
      having count(*) > 1
      order by c desc
      limit 30
    `,
  },
];

const results = [];
for (const query of queries) {
  const child = spawnSync(process.execPath, ["scripts/pg-readonly-query.mjs", query.sql], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (child.status !== 0) {
    results.push({ name: query.name, error: child.stderr.trim() || child.stdout.trim() });
    continue;
  }
  results.push({ name: query.name, result: JSON.parse(child.stdout) });
}

fs.writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
