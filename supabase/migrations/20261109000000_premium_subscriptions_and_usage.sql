-- Premium subscriptions (Paystack) + monthly usage metering for Learn and Answers

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'monthly', 'lifetime')),
  status text not null default 'active' check (status in ('active', 'expired')),
  current_period_end timestamptz, -- null for free and lifetime; set for monthly
  paystack_customer_code text,
  paystack_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('learn', 'answers')),
  ref_id uuid, -- workspace_id (learn) or question_set id (answers), best-effort
  created_at timestamptz not null default now()
);
create index if not exists usage_events_user_kind_month_idx
  on public.usage_events (user_id, kind, created_at desc);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null unique,
  plan text not null check (plan in ('monthly', 'lifetime')),
  amount_kobo integer not null,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_user_idx on public.payments (user_id, created_at desc);

alter table public.subscriptions enable row level security;
alter table public.usage_events enable row level security;
alter table public.payments enable row level security;

drop policy if exists "own subscription" on public.subscriptions;
create policy "own subscription" on public.subscriptions
  for select using (user_id = auth.uid());

drop policy if exists "own usage" on public.usage_events;
create policy "own usage" on public.usage_events
  for select using (user_id = auth.uid());

drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments
  for select using (user_id = auth.uid());

-- No client insert/update policies on purpose: subscriptions and payments are
-- only written by Edge Functions (service role, after a verified Paystack
-- charge). usage_events are only written through check_and_record_usage()
-- below (security definer), so the free-tier limit can't be bypassed by a
-- client inserting its own rows directly.

-- Atomically checks this month's usage against the free-tier limit (5/kind)
-- and records the use if allowed. Premium (monthly, not expired, or
-- lifetime) is always allowed and still recorded, for the usage display.
create or replace function public.check_and_record_usage(p_kind text, p_ref_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_period_end timestamptz;
  v_is_premium boolean;
  v_count int;
  v_limit constant int := 5;
  v_month_start timestamptz := date_trunc('month', now());
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_kind not in ('learn', 'answers') then
    raise exception 'invalid kind: %', p_kind;
  end if;

  select plan, current_period_end into v_plan, v_period_end
  from public.subscriptions where user_id = v_user;

  v_is_premium := coalesce(v_plan, 'free') = 'lifetime'
    or (v_plan = 'monthly' and v_period_end is not null and v_period_end > now());

  select count(*) into v_count
  from public.usage_events
  where user_id = v_user and kind = p_kind and created_at >= v_month_start;

  if not v_is_premium and v_count >= v_limit then
    return jsonb_build_object('allowed', false, 'used', v_count, 'limit', v_limit, 'premium', false);
  end if;

  insert into public.usage_events (user_id, kind, ref_id) values (v_user, p_kind, p_ref_id);

  return jsonb_build_object('allowed', true, 'used', v_count + 1, 'limit', v_limit, 'premium', v_is_premium);
end;
$$;

-- Read-only summary for the profile usage display. Missing subscription row
-- (never upgraded) reads as the free plan.
create or replace function public.get_usage_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_period_end timestamptz;
  v_is_premium boolean;
  v_month_start timestamptz := date_trunc('month', now());
  v_learn int;
  v_answers int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select plan, current_period_end into v_plan, v_period_end
  from public.subscriptions where user_id = v_user;
  v_plan := coalesce(v_plan, 'free');

  v_is_premium := v_plan = 'lifetime'
    or (v_plan = 'monthly' and v_period_end is not null and v_period_end > now());

  select
    count(*) filter (where kind = 'learn'),
    count(*) filter (where kind = 'answers')
  into v_learn, v_answers
  from public.usage_events
  where user_id = v_user and created_at >= v_month_start;

  return jsonb_build_object(
    'plan', v_plan,
    'is_premium', v_is_premium,
    'period_end', v_period_end,
    'learn_used', coalesce(v_learn, 0),
    'answers_used', coalesce(v_answers, 0),
    'limit', 5
  );
end;
$$;

grant execute on function public.check_and_record_usage(text, uuid) to authenticated;
grant execute on function public.get_usage_summary() to authenticated;
