create table if not exists public.activity_checkins (
    id text primary key,
    owner_id text,
    site_id text not null,
    site_name text not null,
    district text,
    visitor_name text not null,
    note text,
    photo_url text not null,
    created_at timestamptz not null default now(),
    distance_label text,
    lat double precision,
    lng double precision
);

alter table public.activity_checkins
add column if not exists owner_id text;

create index if not exists activity_checkins_owner_site_created_idx
on public.activity_checkins (owner_id, site_id, created_at desc);

create or replace function public.current_checkin_owner_id()
returns text
language sql
stable
as $$
    select coalesce(
        nullif(
            coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb)
            ->> 'x-red-map-owner-id',
            ''
        ),
        ''
    );
$$;

grant execute on function public.current_checkin_owner_id() to anon;
grant select, insert, delete on table public.activity_checkins to anon;

alter table public.activity_checkins enable row level security;

drop policy if exists "Public can read checkins" on public.activity_checkins;
drop policy if exists "Public can read own checkins" on public.activity_checkins;
create policy "Public can read checkins"
on public.activity_checkins
for select
to anon
using (owner_id = public.current_checkin_owner_id());

drop policy if exists "Public can insert checkins" on public.activity_checkins;
drop policy if exists "Public can insert own checkins" on public.activity_checkins;
create policy "Public can insert checkins"
on public.activity_checkins
for insert
to anon
with check (
    owner_id = public.current_checkin_owner_id()
    and owner_id <> ''
);

drop policy if exists "Public can delete checkins" on public.activity_checkins;
drop policy if exists "Public can delete own checkins" on public.activity_checkins;
create policy "Public can delete checkins"
on public.activity_checkins
for delete
to anon
using (
    owner_id = public.current_checkin_owner_id()
    and owner_id <> ''
);

insert into storage.buckets (id, name, public)
values ('checkin-photos', 'checkin-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "Public can read checkin photos" on storage.objects;
create policy "Public can read checkin photos"
on storage.objects
for select
to anon
using (bucket_id = 'checkin-photos');

drop policy if exists "Public can upload checkin photos" on storage.objects;
drop policy if exists "Public can upload own checkin photos" on storage.objects;
create policy "Public can upload checkin photos"
on storage.objects
for insert
to anon
with check (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = 'activity-checkins'
    and (storage.foldername(name))[2] = public.current_checkin_owner_id()
    and public.current_checkin_owner_id() <> ''
);

drop policy if exists "Public can delete checkin photos" on storage.objects;
drop policy if exists "Public can delete own checkin photos" on storage.objects;
create policy "Public can delete checkin photos"
on storage.objects
for delete
to anon
using (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] = 'activity-checkins'
    and (storage.foldername(name))[2] = public.current_checkin_owner_id()
    and public.current_checkin_owner_id() <> ''
);
