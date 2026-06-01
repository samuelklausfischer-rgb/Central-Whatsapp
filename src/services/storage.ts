import supabase from '@/lib/supabase/client'

const BUCKET = 'chat-attachments'

export async function uploadAudio(blob: Blob, userId: string): Promise<string> {
  const fileName = `audio/${userId}/${Date.now()}-${crypto.randomUUID()}.webm`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, blob, {
      contentType: 'audio/webm',
      cacheControl: '3600',
    })

  if (error) throw new Error(`Erro ao enviar áudio: ${error.message}`)

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(fileName)

  return urlData.publicUrl
}

export function classifyFileType(file: File): { type: string; mime: string } {
  if (file.type.startsWith('image/')) return { type: 'image', mime: file.type }
  if (file.type.startsWith('video/')) return { type: 'video', mime: file.type }
  if (file.type === 'application/pdf') return { type: 'document', mime: file.type }
  if (
    file.type.includes('word') ||
    file.type.includes('spreadsheet') ||
    file.type.includes('excel') ||
    file.type.includes('text/plain')
  )
    return { type: 'document', mime: file.type }
  return { type: 'document', mime: 'application/octet-stream' }
}

export async function uploadFile(file: File, userId: string): Promise<{ url: string; type: string; name: string }> {
  const ext = file.name.split('.').pop() || 'bin'
  const { type } = classifyFileType(file)
  const folder = type === 'image' ? 'images' : type === 'video' ? 'videos' : 'documents'
  const fileName = `${folder}/${userId}/${Date.now()}-${crypto.randomUUID()}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, file, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    })

  if (error) throw new Error(`Erro ao enviar anexo: ${error.message}`)

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(fileName)

  return { url: urlData.publicUrl, type, name: file.name }
}
