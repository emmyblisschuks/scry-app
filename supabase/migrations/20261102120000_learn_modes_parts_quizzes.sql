-- Objective vs theory Learn mode, chosen per course at upload
alter table public.materials
  add column if not exists learn_mode text not null default 'theory';
alter table public.materials
  drop constraint if exists materials_learn_mode_check;
alter table public.materials
  add constraint materials_learn_mode_check check (learn_mode in ('objective','theory'));

-- Long units are taught in parts (no more silent truncation)
alter table public.material_units
  add column if not exists part_number integer not null default 1,
  add column if not exists total_parts integer not null default 1,
  add column if not exists split_version integer not null default 1;

-- Optional quiz after each unit (keyed to the unit's last part)
create table if not exists public.unit_quizzes (
  material_unit_id uuid primary key references public.material_units(id) on delete cascade,
  mode text not null check (mode in ('objective','theory')),
  questions jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  material_unit_id uuid not null references public.material_units(id) on delete cascade,
  answers jsonb not null,
  score integer not null,
  total integer not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quiz_attempts_user_unit_idx
  on public.quiz_attempts (user_id, material_unit_id, created_at desc);

alter table public.unit_quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
drop policy if exists "own attempts" on public.quiz_attempts;
create policy "own attempts" on public.quiz_attempts
  for select using (user_id = auth.uid());
