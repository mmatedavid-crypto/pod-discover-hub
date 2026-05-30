-- Read-only role for external code review (Codex)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    CREATE ROLE readonly_codex LOGIN PASSWORD 'CHANGE_ME_AFTER_MIGRATION' NOINHERIT;
  END IF;
END
$$;

-- Connect + schema usage
GRANT CONNECT ON DATABASE postgres TO readonly_codex;
GRANT USAGE ON SCHEMA public TO readonly_codex;

-- Read all existing tables / sequences / functions in public
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_codex;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO readonly_codex;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO readonly_codex;

-- Future tables/sequences/functions in public auto-grant SELECT/EXECUTE
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_codex;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO readonly_codex;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO readonly_codex;