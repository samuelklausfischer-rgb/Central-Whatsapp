# rateio-omie

Edge Function do projeto Supabase **Financeiro**. Lança no Omie a conta a pagar do rateio da
Mobilemed. Contrato: `docs/rateio-omie/CONTRATO.md`. Ações: `analisar`, `lancar`, `vincular`,
`departamentos`. Não existe exclusão: desfazer é manual no Omie, com aprovação humana.

Código puro e testado em `../_shared/rateio-omie/` (`node --test supabase/functions/_shared/rateio-omie/*.test.ts`).

## Secrets (projeto Financeiro)

| Secret | Uso |
|---|---|
| `APP_KEY_OMIE_PRN`, `APP_SECRET_OMIE_PRN` | conta PRN (empresas PRN e PRN_APICE) |
| `APP_KEY_OMIE_MEDIMAGEM`, `APP_SECRET_OMIE_MEDIMAGEM` | conta MEDIMAGEM (MEDIMAGEM e MEDIMAGEM_APICE) |
| `OMIE_ESCRITA` | `liberada` habilita `IncluirContaPagar`. Qualquer outro valor (ou ausente) = só leitura |
| `RATEIO_OMIE_TETO` | valor máximo por conta, em reais. Ausente = bloqueio `CONFIG_AUSENTE` |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem no ambiente da função.

## Deploy

Exige `verify_jwt = true` (padrão). Pelo CLI, a partir da raiz do repo (a pasta `_shared` entra junto):

```
supabase functions deploy rateio-omie --project-ref <ref do Financeiro>
```

Antes: aplicar `supabase/migrations-financeiro/20261007120000_rateio_omie.sql`, preencher
`rateio_omie_config` e `rateio_omie_autorizados`, rodar o seed do mapa.

## Desligar

- Só a escrita: remover (ou mudar) o secret `OMIE_ESCRITA`. `lancar` passa a devolver `ESCRITA_DESLIGADA`
  e apaga a linha `enviando`; `analisar`, `vincular` e `departamentos` continuam funcionando.
- Tudo: remover o usuário de `rateio_omie_autorizados` ou apagar a função.
