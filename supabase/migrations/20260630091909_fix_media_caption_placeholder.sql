-- Fix: media placeholders ([Imagem]/[Vídeo]/[Documento]/[Mídia]) were leaking as the
-- WhatsApp caption because public.send_whatsapp_message only excluded [Áudio] and [Anexo]
-- from the caption. The frontend sends content='[Imagem]' etc. when no caption is typed,
-- so those placeholders passed the filter and were sent as the /message/sendMedia caption.
--
-- This patches the caption-exclusion list on BOTH overloads by reading the current
-- definition, doing a targeted replace, and re-creating the function. Idempotent
-- (skips overloads already patched). Also tolerates the legacy mojibake '[VÃ­deo]'
-- emitted by installed app builds until they update.
DO $$
DECLARE
  r record;
  newdef text;
  changed int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'send_whatsapp_message'
  LOOP
    -- Already patched? skip.
    IF position('''[Imagem]''' in r.def) > 0 THEN
      CONTINUE;
    END IF;

    newdef := replace(
      r.def,
      'p_content != ''[Áudio]'' AND p_content != ''[Anexo]''',
      'p_content NOT IN (''[Áudio]'', ''[Anexo]'', ''[Imagem]'', ''[Vídeo]'', ''[VÃ­deo]'', ''[Documento]'', ''[Mídia]'')'
    );

    IF newdef = r.def THEN
      RAISE EXCEPTION 'caption-exclusion pattern not found in %, aborting', r.oid::regprocedure;
    END IF;

    EXECUTE newdef;
    changed := changed + 1;
  END LOOP;

  RAISE NOTICE 'send_whatsapp_message: patched % overload(s)', changed;
END $$;
