import { useEffect, useMemo, useState, type ChangeEvent, type MouseEvent } from 'react'
import { format } from 'date-fns'
import { FileSpreadsheet, Loader2, Trash2, UploadCloud, CheckCircle2, Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  type HistoryFileReference,
  listHistoryFiles,
  uploadHistoryFile,
  deleteHistoryFile,
  downloadHistoryFile,
} from '@/services/prn-analise/prn-service'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const MAX_FILE_SIZE = 10 * 1024 * 1024

type SavedHistorySelection = {
  name: string
  originalFilename?: string | null
}

export type HistoricalFilesSelection = {
  saved: SavedHistorySelection[]
  temporary: File[]
}

const normalizeSelection = (value: HistoricalFilesSelection | null | undefined): HistoricalFilesSelection => ({
  saved: Array.isArray(value?.saved) ? value.saved : [],
  temporary: Array.isArray(value?.temporary) ? value.temporary : [],
})

const buildTempFileKey = (file: File) => `${file.name}-${file.size}-${file.lastModified}`

const dedupeTemporaryFiles = (files: File[]) => {
  const seen = new Set<string>()

  return files.filter((file) => {
    const key = buildTempFileKey(file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function HistoricalFileSelector({
  value,
  onChange,
}: {
  value: HistoricalFilesSelection | null
  onChange: (val: HistoricalFilesSelection) => void
}) {
  const { toast } = useToast()
  const [files, setFiles] = useState<HistoryFileReference[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<HistoryFileReference | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null)
  const selection = useMemo(() => normalizeSelection(value), [value])

  const fetchFiles = async () => {
    setIsLoading(true)
    try {
      const data = await listHistoryFiles()
      setFiles(data)
    } catch (error) {
      console.error('Failed to load history files', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchFiles()
  }, [])

  const toggleSavedFile = (file: HistoryFileReference) => {
    const isSelected = selection.saved.some((selected) => selected.name === file.name)

    const nextSaved = isSelected
      ? selection.saved.filter((selected) => selected.name !== file.name)
      : [...selection.saved, { name: file.name, originalFilename: file.originalFilename }]

    onChange({ ...selection, saved: nextSaved })
  }

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const incomingFiles = Array.from(e.target.files || [])
    if (incomingFiles.length === 0) return

    const validFiles = incomingFiles.filter((file) => file.size <= MAX_FILE_SIZE)
    const invalidFiles = incomingFiles.filter((file) => file.size > MAX_FILE_SIZE)

    if (invalidFiles.length > 0) {
      toast({
        title: 'Arquivo muito grande',
        description:
          invalidFiles.length === 1
            ? `"${invalidFiles[0].name}" excede o limite de 10MB.`
            : `${invalidFiles.length} arquivos excedem o limite de 10MB.`,
        variant: 'destructive',
      })
    }

    if (validFiles.length === 0) {
      if (e.target) e.target.value = ''
      return
    }

    try {
      setIsUploading(true)
      const results = await Promise.allSettled(validFiles.map((file) => uploadHistoryFile(file)))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failedCount = results.length - successCount

      if (successCount > 0) {
        toast({
          title: 'Sucesso',
          description:
            successCount === 1
              ? 'Arquivo histórico salvo no cofre.'
              : `${successCount} arquivos históricos salvos no cofre.`,
        })
      }

      if (failedCount > 0) {
        toast({
          title: 'Erro',
          description:
            failedCount === 1
              ? 'Um arquivo não pôde ser salvo no cofre.'
              : `${failedCount} arquivos não puderam ser salvos no cofre.`,
          variant: 'destructive',
        })
      }

      await fetchFiles()
    } finally {
      setIsUploading(false)
      if (e.target) e.target.value = ''
    }
  }

  const handleDownload = async (file: HistoryFileReference, e: MouseEvent) => {
    e.stopPropagation()
    setDownloadingFile(file.name)
    try {
      const blob = await downloadHistoryFile(file.name, file.originalFilename || undefined)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.originalFilename || file.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (error: any) {
      toast({
        title: 'Erro ao baixar',
        description: error.message || 'Não foi possível baixar o arquivo.',
        variant: 'destructive',
      })
    } finally {
      setDownloadingFile(null)
    }
  }

  const handleDeleteClick = (file: HistoryFileReference, e: MouseEvent) => {
    e.stopPropagation()
    setFileToDelete(file)
  }

  const confirmDelete = async () => {
    if (!fileToDelete) return
    setIsDeleting(true)
    try {
      await deleteHistoryFile(fileToDelete.name)
      toast({ title: 'Sucesso', description: 'Arquivo excluído do cofre.' })

      onChange({
        ...selection,
        saved: selection.saved.filter((selected) => selected.name !== fileToDelete.name),
      })

      await fetchFiles()
    } catch (error: any) {
      toast({
        title: 'Erro',
        description: error.message || 'Falha ao excluir o arquivo.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setFileToDelete(null)
    }
  }

  const handleDirectFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const incomingFiles = Array.from(e.target.files || [])
    if (incomingFiles.length === 0) return

    const validFiles = incomingFiles.filter((file) => file.size <= MAX_FILE_SIZE)
    const invalidFiles = incomingFiles.filter((file) => file.size > MAX_FILE_SIZE)

    if (invalidFiles.length > 0) {
      toast({
        title: 'Arquivo muito grande',
        description:
          invalidFiles.length === 1
            ? `"${invalidFiles[0].name}" excede o limite de 10MB.`
            : `${invalidFiles.length} arquivos excedem o limite de 10MB.`,
        variant: 'destructive',
      })
    }

    if (validFiles.length > 0) {
      onChange({
        ...selection,
        temporary: dedupeTemporaryFiles([...selection.temporary, ...validFiles]),
      })
    }

    if (e.target) e.target.value = ''
  }

  const removeTemporaryFile = (fileToRemove: File) => {
    const targetKey = buildTempFileKey(fileToRemove)

    onChange({
      ...selection,
      temporary: selection.temporary.filter((file) => buildTempFileKey(file) !== targetKey),
    })
  }

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest text-gray-600">
            Cofre de Históricos
          </h4>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {selection.saved.length} do cofre e {selection.temporary.length} temporários selecionados
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={fetchFiles}
          disabled={isLoading || isUploading}
          className="h-7 w-7 p-0 text-gray-400 hover:text-gray-700"
        >
          <Loader2 className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </Button>
      </div>

      <div className="space-y-2">
        {files.map((file) => {
          const isSelected = selection.saved.some((selected) => selected.name === file.name)

          return (
            <div
              key={file.id || file.name}
              onClick={() => toggleSavedFile(file)}
              className={cn(
                'group flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-all',
                isSelected
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50',
              )}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                {isSelected ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-blue-600" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-gray-400 group-hover:text-blue-500 transition-colors" />
                )}
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      'truncate text-sm font-bold',
                      isSelected ? 'text-blue-700' : 'text-gray-700',
                    )}
                  >
                    {file.originalFilename}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-gray-400 mt-0.5">
                    Salvo em {file.created_at ? format(new Date(file.created_at), 'dd/MM/yyyy HH:mm') : '-'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleDownload(file, e)}
                  disabled={downloadingFile === file.name}
                  className="h-8 w-8 p-0 text-gray-300 hover:bg-blue-50 hover:text-blue-500 transition-all"
                  title="Baixar arquivo"
                >
                  {downloadingFile === file.name
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Download className="h-4 w-4" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleDeleteClick(file, e)}
                  className="h-8 w-8 p-0 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all"
                  title="Excluir arquivo"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )
        })}

        {files.length === 0 && !isLoading && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-400">
            Nenhum histórico salvo no cofre.
          </div>
        )}
      </div>

      <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100 transition-all">
        <UploadCloud className="h-4 w-4 text-blue-600" />
        {isUploading ? 'Salvando no cofre...' : 'Fazer upload de novos históricos no cofre'}
        <input
          type="file"
          className="hidden"
          accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={isUploading}
          multiple
          onChange={handleFileUpload}
        />
      </label>

      <div className="space-y-3 border-t border-gray-100 pt-4">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-widest text-gray-600">
            Arquivos Temporários
          </h4>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            Entra apenas nesta execução e pode ser combinado com o cofre.
          </p>
        </div>

        {selection.temporary.length > 0 ? (
          <div className="space-y-2">
            {selection.temporary.map((file) => (
              <div
                key={buildTempFileKey(file)}
                className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-3"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-amber-600" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-amber-800">{file.name}</div>
                    <div className="text-[10px] uppercase tracking-widest text-amber-500 mt-0.5">
                      Apenas para esta execução
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTemporaryFile(file)}
                  className="h-8 w-8 p-0 text-amber-500 hover:bg-amber-100 hover:text-amber-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-transparent p-4 text-center text-sm font-bold text-gray-400">
            Nenhum arquivo temporário selecionado.
          </div>
        )}

        <label className="relative flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 bg-transparent px-4 py-3 text-sm font-bold text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all">
          Usar arquivos temporários sem salvar
          <input
            type="file"
            className="hidden"
            accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            onChange={handleDirectFileSelect}
          />
        </label>
      </div>
    </div>

    <AlertDialog open={!!fileToDelete} onOpenChange={(open) => !open && setFileToDelete(null)}>
      <AlertDialogContent className="bg-white border-gray-200 text-gray-900">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-xl font-bold">Excluir arquivo do cofre</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-500">
            Você realmente deseja excluir "{fileToDelete?.originalFilename}" do cofre de históricos?
            Esta ação não pode ser desfeita.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-white border-gray-200 hover:bg-gray-50 text-gray-700">
            Não
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              confirmDelete()
            }}
            disabled={isDeleting}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Sim, excluir'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
