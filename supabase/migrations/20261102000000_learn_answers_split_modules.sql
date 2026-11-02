-- Learn and Answers each get their own workspaces
alter table public.workspaces
  add column if not exists kind text not null default 'answers';
alter table public.workspaces
  drop constraint if exists workspaces_kind_check;
alter table public.workspaces
  add constraint workspaces_kind_check check (kind in ('answers','learn'));

-- Module -> Unit structure for Learn
alter table public.material_units
  add column if not exists module_number integer,
  add column if not exists module_title text,
  add column if not exists unit_in_module integer;

create index if not exists material_units_material_order_idx
  on public.material_units (material_id, unit_number);
