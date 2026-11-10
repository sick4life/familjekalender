-- Familjekalender: kör hela filen i Supabase → SQL Editor → Run

create extension if not exists pgcrypto;

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#4f7cff',
  sort int not null default 0
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  emoji text not null default '✅',
  assignee uuid references people(id) on delete set null,
  recur text not null default 'weekly'
    check (recur in ('once','daily','weekly','monthly','interval','quick')),
  weekdays int[] not null default '{}',      -- 1 = mån ... 7 = sön
  every int not null default 1,              -- var N:e dag/vecka/månad
  monthday int,
  start_date date not null default current_date,
  end_date date,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete set null,
  title text not null,
  emoji text,
  person_id uuid references people(id) on delete set null,
  for_date date not null default current_date,
  done_at timestamptz not null default now()
);
create index if not exists completions_done_at on completions(done_at);

create table if not exists app_settings (
  key text primary key,
  value jsonb
);

-- Google-token. Inga policies = ingen app-användare kan läsa den, bara servern (edge function).
create table if not exists google_auth (
  id int primary key default 1,
  refresh_token text,
  access_token text,
  expires_at timestamptz,
  email text
);

alter table people enable row level security;
alter table tasks enable row level security;
alter table completions enable row level security;
alter table app_settings enable row level security;
alter table google_auth enable row level security;

drop policy if exists "family" on people;
drop policy if exists "family" on tasks;
drop policy if exists "family" on completions;
drop policy if exists "family" on app_settings;
create policy "family" on people for all to authenticated using (true) with check (true);
create policy "family" on tasks for all to authenticated using (true) with check (true);
create policy "family" on completions for all to authenticated using (true) with check (true);
create policy "family" on app_settings for all to authenticated using (true) with check (true);

-- Live-uppdatering mellan iPad och telefoner
do $$ begin
  alter publication supabase_realtime add table people, tasks, completions, app_settings;
exception when others then null; end $$;

-- Startdata (ändra namn och färger i appen under Inställningar)
insert into people (name, color, sort)
select * from (values ('Peter', '#4f7cff', 1), ('Hanna', '#f0568c', 2)) v(name, color, sort)
where not exists (select 1 from people);

insert into tasks (title, emoji, recur, weekdays, sort)
select * from (values
  ('Tvätta', '🧺', 'weekly', '{1}'::int[], 1),
  ('Städa', '🧹', 'weekly', '{6}'::int[], 2),
  ('Ta ut soporna', '🗑️', 'weekly', '{3,7}'::int[], 3),
  ('Diska', '🍽️', 'quick', '{}'::int[], 10),
  ('Töm diskmaskinen', '🫧', 'quick', '{}'::int[], 11),
  ('Laga mat', '🍳', 'quick', '{}'::int[], 12),
  ('Dammsuga', '🧽', 'quick', '{}'::int[], 13),
  ('Handla', '🛒', 'quick', '{}'::int[], 14)
) v(title, emoji, recur, weekdays, sort)
where not exists (select 1 from tasks);
