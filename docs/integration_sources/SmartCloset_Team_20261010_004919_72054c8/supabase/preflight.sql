-- Read-only metadata/counts. Confirm the connection target ref separately before using.
select current_database() as database_name, version() as postgres_version;
select table_schema,table_name from information_schema.tables where table_schema='public' and table_name like 'sc\_%' escape '\' order by table_name;
select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='public' and p.proname like 'sc\_%' escape '\') or n.nspname='sc_private';
select schemaname,tablename,policyname,roles,cmd from pg_policies where schemaname='public' or (schemaname='storage' and policyname like 'sc\_%' escape '\');
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id='sc-private-assets';
select count(*) as auth_user_count from auth.users;
-- Stop if any sc_* object/bucket already exists. Apply one additive migration only after review.
