import { File, FileArchive, FileSpreadsheet, FileText, Presentation, type LucideIcon } from 'lucide-react'

export type FileTypeMeta = {
  icon: LucideIcon
  label: string
  iconClass: string
  bgClass: string
}

const GENERIC: FileTypeMeta = {
  icon: File,
  label: 'Arquivo',
  iconClass: 'text-gray-500 dark:text-gray-400',
  bgClass: 'bg-gray-100 dark:bg-gray-800',
}

const RULES: Array<{ extensions: string[]; meta: FileTypeMeta }> = [
  {
    extensions: ['pdf'],
    meta: {
      icon: FileText,
      label: 'PDF',
      iconClass: 'text-red-500 dark:text-red-400',
      bgClass: 'bg-red-50 dark:bg-red-950',
    },
  },
  {
    extensions: ['doc', 'docx', 'rtf', 'odt'],
    meta: {
      icon: FileText,
      label: 'Documento',
      iconClass: 'text-blue-500 dark:text-blue-400',
      bgClass: 'bg-blue-50 dark:bg-blue-950',
    },
  },
  {
    extensions: ['xls', 'xlsx', 'csv', 'ods'],
    meta: {
      icon: FileSpreadsheet,
      label: 'Planilha',
      iconClass: 'text-green-600 dark:text-green-400',
      bgClass: 'bg-green-50 dark:bg-green-950',
    },
  },
  {
    extensions: ['ppt', 'pptx', 'odp'],
    meta: {
      icon: Presentation,
      label: 'Apresentação',
      iconClass: 'text-orange-500 dark:text-orange-400',
      bgClass: 'bg-orange-50 dark:bg-orange-950',
    },
  },
  {
    extensions: ['zip', 'rar', '7z', 'tar', 'gz'],
    meta: {
      icon: FileArchive,
      label: 'Compactado',
      iconClass: 'text-amber-600 dark:text-amber-400',
      bgClass: 'bg-amber-50 dark:bg-amber-950',
    },
  },
]

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : ''
}

export function getFileTypeMeta(filename: string): FileTypeMeta {
  const ext = getFileExtension(filename)
  const rule = RULES.find((r) => r.extensions.includes(ext))
  return rule?.meta ?? GENERIC
}

export function isPdfFile(filename: string): boolean {
  return getFileExtension(filename) === 'pdf'
}

export function isExcelFile(filename: string): boolean {
  return ['xls', 'xlsx'].includes(getFileExtension(filename))
}
