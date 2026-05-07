create table if not exists public.activity_checkins (
    id text primary key,
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

alter table public.activity_checkins enable row level security;

drop policy if exists "Public can read checkins" on public.activity_checkins;
create policy "Public can read checkins"
on public.activity_checkins
for select
to anon
using (true);

drop policy if exists "Public can insert checkins" on public.activity_checkins;
create policy "Public can insert checkins"
on public.activity_checkins
for insert
to anon
with check (true);
