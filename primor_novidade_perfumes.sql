-- Primor - habilita o selo "Recem-chegado" no painel de admin.
-- Rode no SQL Editor do Supabase uma unica vez.

alter table public.perfumes
add column if not exists novidade boolean not null default false;

create index if not exists perfumes_novidade_idx
on public.perfumes (novidade);
