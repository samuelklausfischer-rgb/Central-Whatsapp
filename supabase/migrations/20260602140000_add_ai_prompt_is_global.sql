ALTER TABLE ai_assistant_prompts ADD COLUMN is_global BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS select_ai_assistant_prompts ON ai_assistant_prompts;
CREATE POLICY select_ai_assistant_prompts ON ai_assistant_prompts
  FOR SELECT USING (
    (user_id = auth.uid()) OR _is_admin() OR (is_global = true AND is_active = true)
  );

DROP POLICY IF EXISTS insert_ai_assistant_prompts ON ai_assistant_prompts;
CREATE POLICY insert_ai_assistant_prompts ON ai_assistant_prompts
  FOR INSERT WITH CHECK (
    (user_id = auth.uid() AND is_global IS NOT TRUE) OR _is_admin()
  );

DROP POLICY IF EXISTS update_ai_assistant_prompts ON ai_assistant_prompts;
CREATE POLICY update_ai_assistant_prompts ON ai_assistant_prompts
  FOR UPDATE USING ((user_id = auth.uid()) OR _is_admin())
  WITH CHECK (
    (user_id = auth.uid() AND is_global IS NOT TRUE) OR _is_admin()
  );

DROP POLICY IF EXISTS delete_ai_assistant_prompts ON ai_assistant_prompts;
CREATE POLICY delete_ai_assistant_prompts ON ai_assistant_prompts
  FOR DELETE USING ((user_id = auth.uid()) OR _is_admin());
