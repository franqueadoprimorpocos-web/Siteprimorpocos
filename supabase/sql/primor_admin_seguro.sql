-- Primor - login admin sem expor a senha no front-end.
-- Rode no SQL Editor do Supabase.
-- A tabela public.configuracoes deve ter a linha:
-- chave = 'senha_admin'
-- valor = sua senha atual

create or replace function public.validar_admin_primor(p_senha text)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.configuracoes
         where chave = 'senha_admin'
           and valor = p_senha
    );
$$;

revoke all on function public.validar_admin_primor(text) from public;
grant execute on function public.validar_admin_primor(text) to anon, authenticated;
