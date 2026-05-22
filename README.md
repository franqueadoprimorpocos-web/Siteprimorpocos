# Primor Pocos

Catalogo digital da Perfumaria Primor Pocos, com vitrine publica, area administrativa e integracao com Supabase.

## Estrutura

- `index.html`: pagina principal e catalogo publico.
- `admin.html`: painel administrativo.
- `assets/css/`: estilos da vitrine e do painel.
- `assets/js/script.js`: logica do catalogo, cadastro, consulta e admin.
- `assets/img/`: imagens usadas diretamente pelo catalogo.
- `scripts/`: scripts de build para Vercel.
- `supabase/sql/`: scripts SQL para funcoes, politicas RLS e ajustes do banco.

## Arquivos locais

Estes arquivos podem existir no computador, mas nao devem ir para o Git:

- `.env`: variaveis locais usadas no build.
- `.env.example`: modelo sem chaves reais para lembrar quais variaveis a Vercel precisa.
- `assets/js/env.js`: arquivo publico gerado automaticamente pelo build.
- `public/`: pasta gerada para deploy na Vercel.

## Deploy

Na Vercel, cadastre as variaveis de ambiente do projeto:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Depois disso, o build roda com:

```bash
npm run build
```

O `vercel.json` ja aponta a saida para `public/`.

## Supabase

O script principal de producao fica em:

```text
supabase/sql/primor_rls_producao.sql
```

Use esse arquivo quando precisar recriar funcoes, permissoes e politicas RLS. O arquivo `primor_admin_seguro.sql` foi mantido como apoio historico para a funcao de validacao do admin.
