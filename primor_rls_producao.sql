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

drop policy if exists "public_select_perfumes" on public.perfumes;
drop policy if exists "public_select_marcas" on public.marcas;
drop policy if exists "deny_clientes_direct" on public.clientes;
drop policy if exists "deny_configuracoes_direct" on public.configuracoes;

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

-- Funcoes de admin para migrar o painel para RLS fechado.
-- O JS deve usar estas funcoes para inserir/editar/remover no futuro.

create or replace function public.admin_upsert_perfume(
    p_senha text,
    p_id bigint default null,
    p_nome text default null,
    p_marca text default null,
    p_imagem text default '',
    p_notas text default '',
    p_destaque boolean default false,
    p_novidade boolean default false
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
        insert into public.perfumes (nome, marca, imagem, notas, destaque, novidade)
        values (
            trim(p_nome),
            nullif(trim(coalesce(p_marca, '')), ''),
            coalesce(p_imagem, ''),
            coalesce(p_notas, ''),
            coalesce(p_destaque, false),
            coalesce(p_novidade, false)
        )
        returning id into v_id;
    else
        update public.perfumes
           set nome = trim(p_nome),
               marca = nullif(trim(coalesce(p_marca, '')), ''),
               imagem = coalesce(p_imagem, ''),
               notas = coalesce(p_notas, ''),
               destaque = coalesce(p_destaque, false),
               novidade = coalesce(p_novidade, false)
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
revoke all on function public.admin_upsert_perfume(text,bigint,text,text,text,text,boolean,boolean) from public;
revoke all on function public.admin_delete_perfume(text,bigint) from public;
revoke all on function public.admin_upsert_marca(text,bigint,text) from public;
revoke all on function public.admin_delete_marca(text,bigint) from public;

grant execute on function public.validar_admin_primor(text) to anon, authenticated;
grant execute on function public.upsert_cliente_publico(text,text,text,text,date,text,uuid) to anon, authenticated;
grant execute on function public.exportar_clientes_admin(text) to anon, authenticated;
grant execute on function public.buscar_cliente_publico(text,text) to anon, authenticated;
grant execute on function public.admin_upsert_perfume(text,bigint,text,text,text,text,boolean,boolean) to anon, authenticated;
grant execute on function public.admin_delete_perfume(text,bigint) to anon, authenticated;
grant execute on function public.admin_upsert_marca(text,bigint,text) to anon, authenticated;
grant execute on function public.admin_delete_marca(text,bigint) to anon, authenticated;
