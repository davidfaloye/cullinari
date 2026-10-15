-- Run once as a Postgres superuser (docker-compose runs it automatically on first start).
--
-- Two roles keep row-level security meaningful:
--   cullinari_owner  owns the schema and runs migrations. Never used by the running API.
--   cullinari_app    what the API connects as. Can read/write rows but cannot bypass RLS,
--                    so a missing WHERE tenant_id = ... in application code still cannot
--                    leak another restaurant's data.
-- Change both passwords outside local development.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cullinari_owner') THEN
    CREATE ROLE cullinari_owner LOGIN PASSWORD 'owner' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cullinari_app') THEN
    CREATE ROLE cullinari_app LOGIN PASSWORD 'app' NOBYPASSRLS;
  END IF;
END
$$;

SELECT 'CREATE DATABASE cullinari OWNER cullinari_owner'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cullinari') \gexec

\connect cullinari

GRANT USAGE ON SCHEMA public TO cullinari_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cullinari_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cullinari_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cullinari_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cullinari_app;
ALTER DEFAULT PRIVILEGES FOR ROLE cullinari_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO cullinari_app;
