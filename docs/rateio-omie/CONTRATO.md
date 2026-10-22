# Rateio → Omie: contrato entre as peças

> Fonte da verdade compartilhada pelos executores (função, banco, front e motor). Quem precisar
> mudar algo aqui, para e avisa: mudar o contrato muda as quatro peças.
> Estudo de origem: `PROJETO RATEIO/automacao_rateio/OMIE_INTEGRACAO_ESTUDO.md`.

## Visão geral

```
Tela Rateio Mobilemed (Central-Whatsapp)
  │  sessão do Supabase financeiro (JWT)
  ▼
Edge Function `rateio-omie` (Supabase financeiro, verify_jwt = true)
  ├─ confere: usuário em rateio_omie_autorizados
  ├─ lê com service role: dash_rateio_execucoes.linhas, rateio_omie_mapa, rateio_omie_config, rateio_omie_lancamentos
  ├─ Omie (só ConsultarContaPagar, IncluirContaPagar, ListarDepartamentos, ListarEmpresas)
  └─ grava: rateio_omie_lancamentos, rateio_omie_tentativas, rateio_omie_mapa (ação vincular)
```

- As contas Omie são 2: `PRN` (usada por PRN e PRN_APICE) e `MEDIMAGEM` (usada por MEDIMAGEM e
  MEDIMAGEM_APICE). Secrets: `APP_KEY_OMIE_PRN`, `APP_SECRET_OMIE_PRN`, `APP_KEY_OMIE_MEDIMAGEM`,
  `APP_SECRET_OMIE_MEDIMAGEM`, `OMIE_ESCRITA` (`liberada` habilita IncluirContaPagar) e
  `RATEIO_OMIE_TETO` (valor máximo por conta, em reais).
- `ExcluirContaPagar` **não** existe na função. Desfazer é manual, com aprovação humana.

## Valores e arredondamento

- Tudo é calculado em **centavos inteiros**.
- Valor do departamento = soma do `total` das unidades vinculadas a ele.
- `diferenca = valor_nf − Σ departamentos`. Se `|diferenca| ≤ 100` centavos, ela entra no maior
  departamento (`ajuste = { cod_departamento, centavos }`). Acima disso: bloqueio `NF_DIVERGENTE`.
- `perc = round(valor / valor_nf × 100, 2)`. A sobra até 100,00 vai para o maior departamento.
- Invariantes, garantidas por teste: `Σ nValDep = valor_documento` exato e `Σ nPerDep = 100,00` exato.

## Chave de integração

`RATEIO-{P|PA|M|MA}-{AAAAMM}-{NF}` (`P`=PRN, `PA`=PRN_APICE, `M`=MEDIMAGEM,
`MA`=MEDIMAGEM_APICE; NF só com dígitos e letras, sem espaços). É gravada em
`codigo_lancamento_integracao` e é única em `rateio_omie_lancamentos`.

## POST /functions/v1/rateio-omie

Todas as respostas: HTTP 200 com `{ ok: boolean, ... }`, ou HTTP 401/403 sem sessão/autorização.
Erro inesperado: `{ ok:false, erro: string }`.

### `acao: "analisar"`, que não grava nada

Entrada:
```json
{ "acao": "analisar", "execucao_id": "uuid", "nf": "12345", "valor_nf": 556.07,
  "competencia": "2026-09", "emissao": "2026-10-07", "vencimento": "2026-10-31",
  "conta_corrente": 1234567890 }
```
`vencimento` é opcional (padrão: último dia do mês da emissão). `conta_corrente` é opcional
(padrão: `rateio_omie_config.conta_corrente_padrao`). A empresa vem da própria execução.

Saída:
```json
{ "ok": true,
  "empresa": "MEDIMAGEM_APICE", "conta_omie": "MEDIMAGEM",
  "chave": "RATEIO-MA-202609-12345", "ja_lancado": null,
  "total_rateio": 556.07, "valor_nf": 556.07, "diferenca": 0, "ajuste": null,
  "distribuicao": [ { "cod_departamento": 123, "nome": "Vitoria", "unidades": ["..."],
                      "valor": 100.5, "perc": 18.07 } ],
  "bloqueios": [ { "tipo": "UNIDADE_SEM_DEPARTAMENTO", "mensagem": "...", "referencia": "..." } ],
  "avisos":    [ { "tipo": "VINCULO_BAIXA_CONFIANCA", "mensagem": "...", "referencia": "..." } ],
  "hash": "sha256 da distribuição + cabeçalho" }
```
`ja_lancado`: `null` ou `{ status, omie_codigo_lancamento, criado_em }`.

Bloqueios (impedem `lancar`): `EXECUCAO_SEM_LINHAS`, `EXECUCAO_INCONSISTENTE`
(`|Σ linhas.total − total_geral| > 0,01`), `UNIDADE_SEM_DEPARTAMENTO` (unidade com total ≠ 0 sem
vínculo), `DEPARTAMENTO_INEXISTENTE` (não está ativo no `ListarDepartamentos`), `NF_DIVERGENTE`,
`NF_VAZIA`, `JA_LANCADO`, `CREDENCIAL_EMPRESA_ERRADA` (CNPJ do `ListarEmpresas` ≠
`cnpj_esperado`), `ACIMA_DO_TETO`, `CONFIG_AUSENTE`.

Avisos (não impedem): `VINCULO_BAIXA_CONFIANCA` (confiança MEDIA/BAIXA), `EXECUCAO_COM_PENDENCIAS`,
`AJUSTE_CENTAVOS`.

### `acao: "lancar"`

Entrada: a mesma de `analisar`, mais `"hash"`. A função:
1. refaz a análise; com bloqueio ou hash diferente, recusa (`{ok:false, motivo:"HASH_MUDOU"|"BLOQUEADO", analise}`);
2. insere em `rateio_omie_lancamentos` com `status='enviando'` (o índice único barra clique duplo e lançamento concorrente);
3. `ConsultarContaPagar` pela chave: se a conta existe, `status='lancado'` com o código, sem incluir;
4. senão, `IncluirContaPagar` (só se `OMIE_ESCRITA=liberada`; sem isso devolve `{ok:false, motivo:"ESCRITA_DESLIGADA"}` e apaga a linha `enviando`);
5. termina em `lancado` | `erro` | `incerto` (timeout/rede: obriga a consultar de novo antes de qualquer reenvio).

**Lançamento anterior da mesma chave** (a chave é única: nunca se cria uma 2ª linha, a
existente é reaproveitada):

| Status anterior | `analisar` | `lancar` |
|---|---|---|
| `lancado` | bloqueio `JA_LANCADO` + `ja_lancado` preenchido | recusa |
| `enviando` | bloqueio `LANCAMENTO_EM_ANDAMENTO` | recusa |
| `incerto` | aviso `LANCAMENTO_INCERTO` + `ja_lancado` | reaproveita a linha (`update` para `enviando`) e **sempre** começa pelo `ConsultarContaPagar`: se a conta existe, vira `lancado`; senão, inclui |
| `erro` | aviso `TENTATIVA_ANTERIOR_COM_ERRO` + `ja_lancado` | reaproveita a linha e segue o fluxo normal (Consultar → Incluir) |
| `excluido` | sem bloqueio | reaproveita a linha |

A troca para `enviando` é um `update ... where status in ('incerto','erro','excluido')`
condicional; se nenhuma linha for afetada, outro clique ganhou a corrida e o `lancar` recusa.

`ja_lancado.omie_codigo_lancamento` é número (bigint) ou `null`.

Toda chamada ao Omie gera 1 linha em `rateio_omie_tentativas` (antes e depois). O payload gravado nunca leva app_key nem app_secret.

Saída: `{ ok, status, lancamento_id, omie_codigo_lancamento?, mensagem? }`.
"Lançar tudo" é um laço no front, 1 chamada por empresa. Cada resultado é independente.

### `acao: "vincular"`

Entrada: `{ "acao":"vincular", "empresa":"PRN", "unidade":"ARCO VERDE (PRN)", "cod_departamento": 7054706288 }`.
Confere o departamento no `ListarDepartamentos` da conta e faz upsert em `rateio_omie_mapa`
(`origem='tela'`, `confianca='ALTA'`, `atualizado_por`). Saída: `{ ok, departamento_nome }`.

### `acao: "departamentos"`

Entrada: `{ "acao":"departamentos", "empresa":"PRN" }`. Saída: `{ ok, departamentos:[{cod, nome}] }`
(só ativos, para o seletor do "vincular").

## Regras acrescentadas pela revisão de risco (2026-10-07)

1. **Escrita nunca repete.** Se `IncluirContaPagar` receber REDUNDANT, 425, timeout ou erro de
   rede, não há retry: o lançamento vira `incerto`. Só as leituras têm retry, com backoff curto
   (soma ≤ 20 s por chamada), para caber no limite da Edge Function.
2. **Mesma NF ou mesma execução nunca vão duas vezes**, em qualquer competência:
   - bloqueio `NF_JA_LANCADA`: já existe lançamento ativo (`enviando`/`lancado`/`incerto`) da
     mesma empresa com a mesma NF (comparada só pelos dígitos e letras, sem zeros à esquerda) e
     chave diferente;
   - bloqueio `EXECUCAO_JA_LANCADA`: a mesma `execucao_id` já tem lançamento ativo com outra chave;
   - no banco, índice único parcial em `rateio_omie_lancamentos(execucao_id)` com status ativo.
3. **Valores inválidos:** bloqueio `DEPARTAMENTO_VALOR_INVALIDO` se algum `nValDep ≤ 0` ou
   `nPerDep ≤ 0,00` (incluindo departamento tão pequeno que o % arredonda para 0).
4. **`enviando` órfão:** linha `enviando` com `atualizado_em` (ou `criado_em`) há mais de 10 min
   é tratada como `incerto` (aviso `LANCAMENTO_INCERTO`, e o `lancar` consulta antes de incluir).
5. **Autor da execução:** `dash_rateio_execucoes.criado_por uuid default auth.uid()` + policy de
   INSERT `with check (criado_por = auth.uid())`. O `lancar` exige `execucao.criado_por = usuário`
   (bloqueio `EXECUCAO_DE_OUTRO_USUARIO`). Execuções sem autor (antigas) não são lançáveis.
6. **Hash** passa a cobrir também o config (fornecedor, categoria, tipo de documento) e a chave.
7. **Mensagens de erro do Omie** passam pelo `redigir` (sem app_key/app_secret) antes de ir ao
   browser ou ao banco.
8. **`ListarDepartamentos` em formato inesperado** (sem o campo de inatividade reconhecido) → a
   análise falha fechada (`ok:false`, `erro:"FORMATO_OMIE_INESPERADO"`), sem tratar todos como ativos.
9. **Tela:** para `ja_lancado.status` `incerto`/`erro`, o botão fica disponível com o texto
   "Tentar de novo (vai consultar o Omie antes)". O modal mostra empresa, NF, valor, competência,
   vencimento, conta corrente, nº de departamentos e chave. Os motivos de recusa do `lancar`
   (`JA_LANCADO`, `LANCAMENTO_EM_ANDAMENTO`, `NF_JA_LANCADA`, `EXECUCAO_JA_LANCADA`,
   `HASH_MUDOU`, `ESCRITA_DESLIGADA`, `BLOQUEADO`) têm texto próprio.

## Conta a pagar enviada (IncluirContaPagar)

```
codigo_lancamento_integracao = chave
codigo_cliente_fornecedor    = config.cod_fornecedor
codigo_categoria             = config.cod_categoria
codigo_tipo_documento        = config.tipo_documento ('BOL')
id_conta_corrente            = conta_corrente
data_emissao / data_entrada  = emissao (DD/MM/AAAA)
data_vencimento / data_previsao = vencimento (DD/MM/AAAA)
valor_documento              = valor_nf
numero_documento_fiscal      = nf
numero_parcela               = '001/001'
observacao                   = 'Rateio Mobilemed {empresa} competencia {MM/AAAA} - gerado pelo Central-Whatsapp'
distribuicao                 = [{ cCodDep, nValDep, nPerDep }]
```
Retenções (IR/PIS/COFINS/CSLL) **não** vão na inclusão: o financeiro ajusta no Omie, como hoje.

## Linhas da execução (`dash_rateio_execucoes.linhas`)

Gravadas pelo front a partir de `resposta.linhas` do webhook `rateio-upload`:
```json
[ { "unidade": "ARARAQUARA (PRN)", "soma": 835.43, "PORTAL": 52.36, "INTEGRACAO": 0, "SERVIDOR": 0,
    "ROBO": 12.1, "STORAGE": 36.22, "ADICIONAL": 0, "total": 936.11 } ]
```
`unidade` é o nome exibido no Excel. O mapa casa por `chave()`: sem acento, maiúsculas e espaços
normalizados. Execuções antigas (sem `linhas`) não são lançáveis.
