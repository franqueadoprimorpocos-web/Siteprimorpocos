-- Primor - RLS de producao para Supabase
-- Rode este arquivo no SQL Editor do Supabase.
--
-- Objetivo:
-- 1. Catalogo publico pode ler perfumes e marcas.
-- 2. Clientes podem cadastrar/atualizar seus dados por funcao segura.
-- 3. Configuracoes e clientes nao ficam legiveis diretamente pela chave anon.
-- 4. Admin valida senha e exporta clientes por funcoes SECURITY DEFINER.
--
-- Importante:
-- O painel admin atual ainda faz algumas escritas diretas nas tabelas.
-- Para RLS 100% fechado, o JS do admin deve chamar funcoes RPC de admin.

alter table if exists public.perfumes enable row level security;
alter table if exists public.marcas enable row level security;
alter table if exists public.clientes enable row level security;
alter table if exists public.configuracoes enable row level security;
create table if not exists public.acessos_catalogo (
    id bigserial primary key,
    visitante_hash text not null,
    pagina text,
    user_agent_hash text,
    data_acesso date not null default current_date,
    created_at timestamptz not null default now(),
    constraint acessos_catalogo_visitante_dia_unique unique (visitante_hash, data_acesso)
);
alter table if exists public.acessos_catalogo enable row level security;

alter table if exists public.perfumes add column if not exists novidade boolean default false;
alter table if exists public.perfumes add column if not exists novidade_ate date;
alter table if exists public.perfumes add column if not exists esgotado boolean default false;
alter table if exists public.perfumes add column if not exists sob_demanda boolean default false;
alter table if exists public.perfumes add column if not exists prazo_reposicao text;

update public.perfumes
   set novidade_ate = current_date + 15
 where novidade = true
   and novidade_ate is null;

update public.clientes c
   set nome = nomes.nome_formatado,
       updated_at = now()
  from (
      select id,
             string_agg(
                 case
                     when lower(parte) in ('de', 'da', 'das', 'do', 'dos', 'e') then lower(parte)
                     else initcap(lower(parte))
                 end,
                 ' '
             ) as nome_formatado
        from public.clientes,
             regexp_split_to_table(regexp_replace(trim(nome), '\s+', ' ', 'g'), ' ') as parte
       where nullif(trim(nome), '') is not null
       group by id
  ) nomes
 where c.id = nomes.id
   and c.nome is distinct from nomes.nome_formatado;

drop policy if exists "public_select_perfumes" on public.perfumes;
drop policy if exists "public_select_marcas" on public.marcas;
drop policy if exists "deny_clientes_direct" on public.clientes;
drop policy if exists "deny_configuracoes_direct" on public.configuracoes;
drop policy if exists "deny_acessos_catalogo_direct" on public.acessos_catalogo;

create policy "public_select_perfumes"
on public.perfumes
for select
to anon, authenticated
using (true);

create policy "public_select_marcas"
on public.marcas
for select
to anon, authenticated
using (true);

-- Nao criamos policy de select/insert/update/delete para clientes/configuracoes.
-- O acesso acontece pelas funcoes SECURITY DEFINER abaixo.
-- A tabela de acessos tambem fica fechada; somente RPCs agregadas podem tocar nela.

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

create or replace function public.upsert_cliente_publico(
    p_nome text default null,
    p_email text default null,
    p_telefone text default null,
    p_cpf text default null,
    p_data_nascimento date default null,
    p_origem text default null,
    p_auth_user_id uuid default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
    v_nome text := nullif(trim(coalesce(p_nome, '')), '');
    v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
    v_telefone text := nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '');
    v_cpf text := nullif(regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g'), '');
begin
    if v_nome is not null then
        select string_agg(
                   case
                       when lower(parte) in ('de', 'da', 'das', 'do', 'dos', 'e') then lower(parte)
                       else initcap(lower(parte))
                   end,
                   ' '
               )
          into v_nome
          from regexp_split_to_table(regexp_replace(v_nome, '\s+', ' ', 'g'), ' ') as parte;
    end if;

    if v_nome is null and v_email is null and v_telefone is null then
        raise exception 'Informe nome, email ou telefone.';
    end if;

    select id
      into v_id
      from public.clientes
     where (p_auth_user_id is not null and auth_user_id = p_auth_user_id)
        or (v_email is not null and lower(email) = v_email)
        or (v_telefone is not null and telefone = v_telefone)
        or (v_cpf is not null and cpf = v_cpf)
     order by id
     limit 1;

    if v_id is null then
        insert into public.clientes (
            nome, email, telefone, cpf, data_nascimento, origem, auth_user_id, created_at, updated_at
        )
        values (
            coalesce(v_nome, v_email, v_telefone),
            v_email,
            v_telefone,
            v_cpf,
            p_data_nascimento,
            nullif(trim(coalesce(p_origem, '')), ''),
            p_auth_user_id,
            now(),
            now()
        )
        returning id into v_id;
    else
        update public.clientes
           set nome = coalesce(v_nome, nome),
               email = coalesce(v_email, email),
               telefone = coalesce(v_telefone, telefone),
               cpf = coalesce(v_cpf, cpf),
               data_nascimento = coalesce(p_data_nascimento, data_nascimento),
               origem = coalesce(nullif(trim(coalesce(p_origem, '')), ''), origem),
               auth_user_id = coalesce(p_auth_user_id, auth_user_id),
               updated_at = now()
         where id = v_id;
    end if;

    return v_id;
end;
$$;

create or replace function public.exportar_clientes_admin(p_senha text)
returns table (
    id bigint,
    nome text,
    email text,
    telefone text,
    cpf text,
    data_nascimento date,
    origem text,
    created_at timestamptz,
    updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.validar_admin_primor(p_senha) then
        raise exception 'Nao autorizado.';
    end if;

    return query
    select c.id, c.nome, c.email, c.telefone, c.cpf, c.data_nascimento, c.origem, c.created_at, c.updated_at
      from public.clientes c
     order by c.created_at desc;
end;
$$;

create or replace function public.buscar_cliente_publico(
    p_email text default null,
    p_telefone text default null
)
returns table (
    nome text,
    email text,
    telefone text,
    cpf text,
    data_nascimento date,
    origem text,
    updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    select c.nome, c.email, c.telefone, c.cpf, c.data_nascimento, c.origem, c.updated_at
      from public.clientes c
     where (nullif(lower(trim(coalesce(p_email, ''))), '') is not null
            and lower(c.email) = nullif(lower(trim(coalesce(p_email, ''))), ''))
        or (nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '') is not null
            and c.telefone = nullif(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), ''))
     order by c.updated_at desc
     limit 1;
$$;

create or replace function public.registrar_acesso_catalogo(
    p_visitante_hash text,
    p_pagina text default null,
    p_user_agent_hash text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if nullif(trim(coalesce(p_visitante_hash, '')), '') is null then
        return;
    end if;

    insert into public.acessos_catalogo (
        visitante_hash, pagina, user_agent_hash, data_acesso, created_at
    )
    values (
        trim(p_visitante_hash),
        nullif(left(trim(coalesce(p_pagina, '')), 220), ''),
        nullif(left(trim(coalesce(p_user_agent_hash, '')), 140), ''),
        current_date,
        now()
    )
    on conflict (visitante_hash, data_acesso) do nothing;
end;
$$;

create or replace function public.resumo_acessos_admin(p_senha text)
returns table (
    hoje bigint,
    ultimos_7_dias bigint,
    ultimos_30_dias bigint,
    total bigint,
    ultima_visita timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.validar_admin_primor(p_senha) then
        raise exception 'Nao autorizado.';
    end if;

    return query
    select
        count(*) filter (where data_acesso = current_date)::bigint as hoje,
        count(*) filter (where data_acesso >= current_date - 6)::bigint as ultimos_7_dias,
        count(*) filter (where data_acesso >= current_date - 29)::bigint as ultimos_30_dias,
        count(*)::bigint as total,
        max(created_at) as ultima_visita
      from public.acessos_catalogo;
end;
$$;

-- Funcoes de admin para migrar o painel para RLS fechado.
-- O JS deve usar estas funcoes para inserir/editar/remover no futuro.

drop function if exists public.admin_upsert_perfume(text,bigint,text,text,text,text,boolean,boolean);
drop function if exists public.admin_upsert_perfume(text,bigint,text,text,text,text,boolean,boolean,boolean,boolean,text);
drop function if exists public.admin_upsert_perfume(text,bigint,text,text,text,text,boolean,boolean,date,boolean,boolean,text);

create or replace function public.admin_upsert_perfume(
    p_senha text,
    p_id bigint default null,
    p_nome text default null,
    p_marca text default null,
    p_imagem text default '',
    p_notas text default '',
    p_destaque boolean default false,
    p_novidade boolean default false,
    p_novidade_ate date default null,
    p_esgotado boolean default false,
    p_sob_demanda boolean default false,
    p_prazo_reposicao text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
begin
    if not public.validar_admin_primor(p_senha) then
        raise exception 'Nao autorizado.';
    end if;

    if nullif(trim(coalesce(p_nome, '')), '') is null then
        raise exception 'Nome do perfume obrigatorio.';
    end if;

    if p_id is null then
        insert into public.perfumes (
            nome, marca, imagem, notas, destaque, novidade, novidade_ate, esgotado, sob_demanda, prazo_reposicao
        )
        values (
            trim(p_nome),
            nullif(trim(coalesce(p_marca, '')), ''),
            coalesce(p_imagem, ''),
            coalesce(p_notas, ''),
            coalesce(p_destaque, false),
            coalesce(p_novidade, false),
            case when coalesce(p_novidade, false) then coalesce(p_novidade_ate, current_date + 15) else null end,
            coalesce(p_esgotado, false),
            coalesce(p_sob_demanda, false),
            nullif(trim(coalesce(p_prazo_reposicao, '')), '')
        )
        returning id into v_id;
    else
        update public.perfumes
           set nome = trim(p_nome),
               marca = nullif(trim(coalesce(p_marca, '')), ''),
               imagem = coalesce(p_imagem, ''),
               notas = coalesce(p_notas, ''),
               destaque = coalesce(p_destaque, false),
               novidade = coalesce(p_novidade, false),
               novidade_ate = case when coalesce(p_novidade, false) then coalesce(p_novidade_ate, current_date + 15) else null end,
               esgotado = coalesce(p_esgotado, false),
               sob_demanda = coalesce(p_sob_demanda, false),
               prazo_reposicao = nullif(trim(coalesce(p_prazo_reposicao, '')), '')
         where id = p_id
        returning id into v_id;
    end if;

    return v_id;
end;
$$;

create or replace function public.admin_delete_perfume(p_senha text, p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.validar_admin_primor(p_senha) then
        raise exception 'Nao autorizado.';
    end if;

    delete from public.perfumes where id = p_id;
end;
$$;

create or replace function public.admin_upsert_marca(
    p_senha text,
    p_id bigint default null,
    p_nome text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
begin
    if not public.validar_admin_primor(p_senha) then
        raise exception 'Nao autorizado.';
    end if;

    if nullif(trim(coalesce(p_nome, '')), '') is null then
        raise exception 'Nome da marca obrigatorio.';
    end if;

    if p_id is null then
        insert into public.marcas (nome)
        values (trim(p_nome))
        returning id into v_id;
    else
        update public.marcas
           set nome = trim(p_nome)
         where id = p_id
        returning id into v_id;
    end if;

    return v_id;
end;
$$;

create or replace function public.admin_delete_marca(p_senha text, p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.validar_admin_primor(p_senha) then
        raise exception 'Nao autorizado.';
    end if;

    delete from public.marcas where id = p_id;
end;
$$;

revoke all on function public.validar_admin_primor(text) from public;
revoke all on function public.upsert_cliente_publico(text,text,text,text,date,text,uuid) from public;
revoke all on function public.exportar_clientes_admin(text) from public;
revoke all on function public.buscar_cliente_publico(text,text) from public;
revoke all on function public.registrar_acesso_catalogo(text,text,text) from public;
revoke all on function public.resumo_acessos_admin(text) from public;
revoke all on function public.admin_upsert_perfume(text,bigint,text,text,text,text,boolean,boolean,date,boolean,boolean,text) from public;
revoke all on function public.admin_delete_perfume(text,bigint) from public;
revoke all on function public.admin_upsert_marca(text,bigint,text) from public;
revoke all on function public.admin_delete_marca(text,bigint) from public;

grant execute on function public.validar_admin_primor(text) to anon, authenticated;
grant execute on function public.upsert_cliente_publico(text,text,text,text,date,text,uuid) to anon, authenticated;
grant execute on function public.exportar_clientes_admin(text) to anon, authenticated;
grant execute on function public.buscar_cliente_publico(text,text) to anon, authenticated;
grant execute on function public.registrar_acesso_catalogo(text,text,text) to anon, authenticated;
grant execute on function public.resumo_acessos_admin(text) to anon, authenticated;
grant execute on function public.admin_upsert_perfume(text,bigint,text,text,text,text,boolean,boolean,date,boolean,boolean,text) to anon, authenticated;
grant execute on function public.admin_delete_perfume(text,bigint) to anon, authenticated;
grant execute on function public.admin_upsert_marca(text,bigint,text) to anon, authenticated;
grant execute on function public.admin_delete_marca(text,bigint) to anon, authenticated;
