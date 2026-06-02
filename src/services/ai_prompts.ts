import supabase from '@/lib/supabase/client'
import type { AiPrompt } from '@/lib/supabase/types'

export const getAiPrompts = async () => {
  const { data } = await supabase.from('ai_assistant_prompts').select('*').order('created_at')
  return (data as AiPrompt[]) || []
}

export const createAiPrompt = async (data: {
  label: string
  action_key: string
  system_prompt: string
  user_id: string
  is_global?: boolean
}) => {
  const { data: prompt } = await supabase.from('ai_assistant_prompts').insert(data).select().single()
  return prompt as AiPrompt
}

export const updateAiPrompt = async (id: string, data: Partial<AiPrompt>) => {
  const { data: prompt } = await supabase.from('ai_assistant_prompts').update(data).eq('id', id).select().single()
  return prompt as AiPrompt
}

export const deleteAiPrompt = async (id: string) => {
  await supabase.from('ai_assistant_prompts').delete().eq('id', id)
}
