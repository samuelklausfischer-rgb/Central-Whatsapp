-- ============================================================
-- Fix: conversation_assignments nunca foi adicionada à publicação
-- supabase_realtime. Resultado: a sidebar de conversas (que só
-- atualiza os badges de atendimento via Realtime, sem polling)
-- nunca recebia as mudanças de status/atribuição — Pegar, Designar,
-- Não posso e Finalizar pareciam não refletir em lugar nenhum fora
-- da própria conversa aberta (que recarrega manualmente via RPC).
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_assignments;
