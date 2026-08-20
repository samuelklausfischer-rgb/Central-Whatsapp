-- ITEM 12: transcrição automática de áudio RECEBIDO (Groq/Whisper).
--
-- Duas colunas, não uma. `transcription_status` existe porque o texto sozinho
-- não deixa a interface distinguir "ainda transcrevendo" de "tentou e não
-- deu" — os dois estados têm `transcription` NULL. Sem o status, todo áudio
-- em voo pareceria "sem transcrição" para sempre, e não haveria como mostrar
-- um "transcrevendo..." temporário nem esconder de vez o que falhou.
--
-- 'pending'  -> disparo feito pelo webhook, aguardando resposta da Groq.
-- 'ready'    -> `transcription` preenchido, pronto para exibir.
-- 'failed'   -> a Groq falhou (indisponível, erro, áudio não suportado); o
--               áudio em si nunca é afetado, só não ganha transcrição.
-- NULL       -> não se aplica: mensagem não é áudio recebido, ou é anterior a
--               este recurso. NUNCA é preenchido retroativamente de propósito
--               (decisão do usuário: só áudio novo entra na automação).
alter table public.messages
  add column if not exists transcription text,
  add column if not exists transcription_status text;

alter table public.messages
  drop constraint if exists messages_transcription_status_check;

alter table public.messages
  add constraint messages_transcription_status_check
  check (transcription_status is null or transcription_status in ('pending', 'ready', 'failed'));

comment on column public.messages.transcription is
  'Texto transcrito do áudio recebido (Groq Whisper). NULL para mensagens que não são áudio recebido ou que são anteriores a este recurso.';
comment on column public.messages.transcription_status is
  'pending | ready | failed | NULL (não se aplica). Ver comentário da migration 20260820130000_add_audio_transcription para o porquê de existir separado de `transcription`.';
