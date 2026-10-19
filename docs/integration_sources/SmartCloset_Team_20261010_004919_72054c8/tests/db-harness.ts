import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const OWNER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const THIRD = '33333333-3333-4333-8333-333333333333';
export const schemaDir = resolve('supabase/schema');
export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
  `);
  for (const file of (await readdir(schemaDir)).filter(x => x.endsWith('.sql')).sort()) {
    try { await db.exec(await readFile(resolve(schemaDir, file), 'utf8')); }
    catch (error) { await db.close(); throw new Error(`SQL source ${file}: ${String(error)}`, { cause: error }); }
  }
  await db.query('insert into auth.users(id) values($1),($2),($3)', [OWNER, OTHER, THIRD]);
  await db.query("insert into public.sc_profiles(id,display_name) values($1,'owner fixture'),($2,'second fixture'),($3,'third fixture')", [OWNER, OTHER, THIRD]);
  return db;
}

export async function asRole(db: PGlite, role: 'postgres'|'authenticated'|'anon'|'service_role', owner?: string) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner ?? '']);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}
export async function rpc<T=Record<string, unknown>>(db: PGlite, name: string, args: unknown[]): Promise<T> {
  if (!/^sc_[a-z_]+$/.test(name)) throw new Error('invalid RPC name');
  const params = args.map((_, i) => `$${i+1}`).join(',');
  const r = await db.query<{ result: T }>(`select public.${name}(${params}) as result`, args);
  return r.rows[0].result;
}
