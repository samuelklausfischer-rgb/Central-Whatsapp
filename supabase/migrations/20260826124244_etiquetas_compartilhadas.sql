-- Etiqueta passa a ser da EQUIPE, e não de quem a criou.
--
-- O PROBLEMA
-- As duas tabelas que formam uma etiqueta discordavam sobre quem pode vê-la:
--
--   contact_tags (o vínculo contato<->etiqueta)  ->  auth.role() = 'authenticated'
--   labels       (a etiqueta em si)              ->  user_id = auth.uid() OR _is_admin()
--
-- Então todo mundo já enxergava o VÍNCULO e ninguém enxergava a ETIQUETA do
-- colega. O cliente busca com `select('*, label_id(*)')`, e a RLS fazia esse
-- embed voltar `null`; os dois lugares que desenham etiqueta descartam
-- exatamente esse caso (`tagsByContact` no ChatList, `etiquetasDoContato` no
-- ChatWindow), então a etiqueta simplesmente não aparecia — sem erro nenhum.
--
-- Relato que originou (Ketlin, 25/08/2026): Thiago é gestor de Sabará, a unidade
-- é da Ketlin, e a etiqueta "UN. KETLIN" não aparecia para ele — então não dava
-- para designar a mensagem sem antes perguntar de quem era a unidade.
--
-- O QUE MUDA, E O QUE NÃO MUDA
-- Só o SELECT. INSERT, UPDATE e DELETE continuam `user_id = auth.uid() OR
-- _is_admin()`: ver e aplicar é de todos, mexer continua sendo de quem criou (ou
-- de um admin). Sem isso, qualquer pessoa renomearia a etiqueta da outra.
--
-- Escala no momento da mudança: 3 etiquetas no banco inteiro (MEDICO / TÉCNICO
-- CUIABÁ / UN. KETLIN), sem nomes repetidos. Não há colisão a resolver nem
-- exposição em massa — é literalmente tornar visíveis três linhas.

drop policy if exists select_labels on public.labels;

create policy select_labels on public.labels
  for select
  using (auth.role() = 'authenticated');

comment on table public.labels is
  'Etiquetas de contato e de e-mail. Visíveis para toda a equipe (RLS de SELECT
   aberta a `authenticated` em 26/08/2026); criar, editar e apagar continua
   restrito ao dono ou a um admin.';
