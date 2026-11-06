-- =====================================================================================
-- Rateio -> Omie: configuração por empresa + quem pode lançar.
-- BANCO: Supabase FINANCEIRO. APLICADO em produção em 2026-10-08 (migration rateio_omie_config).
--
-- Valores tirados do espelho do Omie (teste_omie_titulo.payload, contas MOBILEMED rateadas de
-- jul a set/2026), levantados em 2026-10-07:
--   PRN       fornecedor 6889027065 · categoria 2.04.92 · BOL · conta 6860701368 (jul/set; ago usou 7209340243)
--   MEDIMAGEM fornecedor 2443751667 · categoria 2.04.97 · BOL · conta 2428329121 (jul/set; ago usou 2435964512)
-- A conta corrente é só o PADRÃO: a tela permite trocar a cada lançamento.
--
-- CNPJ conferido no Omie (ListarEmpresas, só leitura) em 2026-10-07:
--   PRN       = PRN SERVICOS DE RADIOLOGIA LTDA, 08.646.447/0001-44.
--   MEDIMAGEM = MEDIMAGEM DIAGNOSTICOS LTDA,     35.688.028/0001-48.
--   As chaves CERTAS da MedImagem estão em financeiro-analise/.env (APP_KEY/SECRET_OMIE_MEDIMAGEM).
--   ATENÇÃO: a variável de ambiente APP_KEY/SECRET_OMIE_MEDIMAGEM desta máquina aponta para a
--   CLINICA MED IMAGEM PALHOCA (44.647.938/0001-73), com key e secret invertidos — não usar.
-- A Edge Function compara cnpj_esperado com o ListarEmpresas e BLOQUEIA
-- (CREDENCIAL_EMPRESA_ERRADA) se a chave cadastrada for de outra empresa.
-- =====================================================================================

-- 1) PRN e PRN Ápice (mesma conta Omie).
insert into public.rateio_omie_config
  (empresa, conta_omie, cnpj_esperado, cod_fornecedor, cod_categoria, tipo_documento, conta_corrente_padrao)
values
  ('PRN',       'PRN', '08646447000144', 6889027065, '2.04.92', 'BOL', 6860701368),
  ('PRN_APICE', 'PRN', '08646447000144', 6889027065, '2.04.92', 'BOL', 6860701368)
on conflict (empresa) do update set
  conta_omie = excluded.conta_omie,
  cnpj_esperado = excluded.cnpj_esperado,
  cod_fornecedor = excluded.cod_fornecedor,
  cod_categoria = excluded.cod_categoria,
  tipo_documento = excluded.tipo_documento,
  conta_corrente_padrao = excluded.conta_corrente_padrao;

-- 2) MedImagem e MedImagem Ápice (mesma conta Omie).
insert into public.rateio_omie_config
  (empresa, conta_omie, cnpj_esperado, cod_fornecedor, cod_categoria, tipo_documento, conta_corrente_padrao)
values
  ('MEDIMAGEM',       'MEDIMAGEM', '35688028000148', 2443751667, '2.04.97', 'BOL', 2428329121),
  ('MEDIMAGEM_APICE', 'MEDIMAGEM', '35688028000148', 2443751667, '2.04.97', 'BOL', 2428329121)
on conflict (empresa) do update set
  conta_omie = excluded.conta_omie,
  cnpj_esperado = excluded.cnpj_esperado,
  cod_fornecedor = excluded.cod_fornecedor,
  cod_categoria = excluded.cod_categoria,
  tipo_documento = excluded.tipo_documento,
  conta_corrente_padrao = excluded.conta_corrente_padrao;

-- 3) Quem pode analisar e lançar (ids de auth.users do projeto financeiro).
insert into public.rateio_omie_autorizados (user_id, email) values
  ('decf5cd3-4193-43cd-ab27-1c8ed63f69dc', 'raphaela@prn.com'),
  ('640f8964-11aa-43b0-9616-60719d86d805', 'samuelklausfischer@hotmail.com')
on conflict (user_id) do nothing;
