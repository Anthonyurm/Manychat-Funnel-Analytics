-- ============================================================
-- FUNNEL ANALYTICS SCHEMA
-- Run this entire file in your Supabase SQL Editor
-- ============================================================

-- FUNNELS table
create table public.funnels (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade not null,
  name        text not null,
  version     text default 'OUT NOW',
  status      text default 'active',
  notes       text,
  created_at  timestamptz default now()
);

-- KEYWORDS table
create table public.keywords (
  id          uuid primary key default gen_random_uuid(),
  funnel_id   uuid references public.funnels(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  keyword     text not null
);

-- STEPS table
create table public.steps (
  id           uuid primary key default gen_random_uuid(),
  funnel_id    uuid references public.funnels(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,
  step_order   integer not null,
  label        text,
  step_type    text default 'message',
  message_text text
);

-- STEP METRICS table
create table public.step_metrics (
  id          uuid primary key default gen_random_uuid(),
  step_id     uuid references public.steps(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  recorded_at timestamptz default now(),
  sent        integer,
  opened      integer,
  clicked     integer,
  ctr         float,
  open_rate   float,
  source      text default 'manual'
);

-- CONNECTIONS table
create table public.connections (
  id           uuid primary key default gen_random_uuid(),
  funnel_id    uuid references public.funnels(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,
  from_step_id uuid references public.steps(id) on delete cascade not null,
  to_step_id   uuid references public.steps(id) on delete cascade not null,
  label        text
);

-- SCREENSHOTS table
create table public.screenshots (
  id           uuid primary key default gen_random_uuid(),
  funnel_id    uuid references public.funnels(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,
  file_path    text,
  parsed_at    timestamptz,
  parse_status text default 'pending',
  raw_json     text
);

-- ============================================================
-- ROW LEVEL SECURITY — users can only see their own data
-- ============================================================
alter table public.funnels      enable row level security;
alter table public.keywords     enable row level security;
alter table public.steps        enable row level security;
alter table public.step_metrics enable row level security;
alter table public.connections  enable row level security;
alter table public.screenshots  enable row level security;

-- Funnels policies
create policy "Users see own funnels"   on public.funnels for select using (auth.uid() = user_id);
create policy "Users insert own funnels" on public.funnels for insert with check (auth.uid() = user_id);
create policy "Users update own funnels" on public.funnels for update using (auth.uid() = user_id);
create policy "Users delete own funnels" on public.funnels for delete using (auth.uid() = user_id);

-- Keywords policies
create policy "Users see own keywords"    on public.keywords for select using (auth.uid() = user_id);
create policy "Users insert own keywords" on public.keywords for insert with check (auth.uid() = user_id);
create policy "Users delete own keywords" on public.keywords for delete using (auth.uid() = user_id);

-- Steps policies
create policy "Users see own steps"    on public.steps for select using (auth.uid() = user_id);
create policy "Users insert own steps" on public.steps for insert with check (auth.uid() = user_id);
create policy "Users update own steps" on public.steps for update using (auth.uid() = user_id);
create policy "Users delete own steps" on public.steps for delete using (auth.uid() = user_id);

-- Step metrics policies
create policy "Users see own metrics"    on public.step_metrics for select using (auth.uid() = user_id);
create policy "Users insert own metrics" on public.step_metrics for insert with check (auth.uid() = user_id);
create policy "Users update own metrics" on public.step_metrics for update using (auth.uid() = user_id);
create policy "Users delete own metrics" on public.step_metrics for delete using (auth.uid() = user_id);

-- Connections policies
create policy "Users see own connections"    on public.connections for select using (auth.uid() = user_id);
create policy "Users insert own connections" on public.connections for insert with check (auth.uid() = user_id);
create policy "Users delete own connections" on public.connections for delete using (auth.uid() = user_id);

-- Screenshots policies
create policy "Users see own screenshots"    on public.screenshots for select using (auth.uid() = user_id);
create policy "Users insert own screenshots" on public.screenshots for insert with check (auth.uid() = user_id);
create policy "Users update own screenshots" on public.screenshots for update using (auth.uid() = user_id);

-- ============================================================
-- STORAGE BUCKET for screenshot uploads
-- ============================================================
insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false);

create policy "Users upload own screenshots" on storage.objects
  for insert with check (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users view own screenshots" on storage.objects
  for select using (bucket_id = 'screenshots' and auth.uid()::text = (storage.foldername(name))[1]);
