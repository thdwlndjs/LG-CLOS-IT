-- Private originals/results. Never rewrite an existing bucket or Storage-wide grants.
begin;
do $$ begin
  if exists(select 1 from storage.buckets where id='sc-private-assets') then raise exception 'conflict: sc-private-assets bucket already exists; inspect before migration'; end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('sc-private-assets','sc-private-assets',false,209715200,array['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
create policy sc_storage_read on storage.objects for select to authenticated
using(bucket_id='sc-private-assets' and exists(select 1 from public.sc_assets a where a.bucket_id=objects.bucket_id and a.storage_key=objects.name and ((a.owner_id=(select auth.uid()) and a.status in ('pending','finalized')) or (a.status='finalized' and sc_private.can_access(a.owner_id,'asset',a.id)))));
create policy sc_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='sc-private-assets' and exists(select 1 from public.sc_assets a where a.bucket_id=objects.bucket_id and a.storage_key=objects.name and a.owner_id=(select auth.uid()) and a.status='pending' and a.provenance='user_upload'));
-- No UPDATE/DELETE policy: upload with upsert=false; replacements create new IDs/versions.
-- Bucket privacy alone is insufficient; select/upload also require the matching metadata row.
commit;
