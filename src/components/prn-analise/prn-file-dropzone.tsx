import { UploadCloud, FileSpreadsheet, X, CheckCircle2 } from 'lucide-react'
import { FormControl, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function FileUploadDropzone({ field, label, disabled }: any) {
  const file = field.value?.[0] as File | undefined

  return (
    <FormItem className="w-full">
      <FormLabel className="text-gray-600 font-bold text-xs uppercase tracking-widest">{label}</FormLabel>
      <FormControl>
        {!file ? (
          <div
            className={cn(
              'relative group flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-2xl transition-all duration-300',
              disabled
                ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                : 'bg-gray-50 border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer',
            )}
          >
            <input
              type="file"
              accept=".xlsx, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={disabled}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
              onChange={(e) => {
                if (e.target.files?.length) {
                  field.onChange(Array.from(e.target.files))
                }
              }}
            />
            <div className="flex flex-col items-center gap-3 text-center relative z-0">
              <div className="p-4 bg-blue-100 rounded-2xl group-hover:bg-blue-200 group-hover:scale-110 transition-all duration-300">
                <UploadCloud className="h-8 w-8 text-blue-600" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-gray-700 group-hover:text-blue-600 transition-colors">
                  Arraste seu arquivo Excel
                </p>
                <p className="text-[10px] text-gray-400 font-medium uppercase tracking-tighter">
                  Apenas .xlsx (Máximo 10MB)
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4 p-4 border border-blue-200 rounded-2xl bg-blue-50 shadow-sm animate-in zoom-in-95 duration-300">
            <div className="p-3 bg-blue-100 rounded-xl border border-blue-200 shadow-inner shrink-0">
              <FileSpreadsheet className="h-6 w-6 text-blue-600" />
            </div>
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-gray-800 truncate" title={file.name}>
                  {file.name}
                </span>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              </div>
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 h-9 w-9 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
              disabled={disabled}
              onClick={() => field.onChange(undefined)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </FormControl>
      <FormMessage className="text-red-500 font-bold text-[10px] uppercase mt-2" />
    </FormItem>
  )
}
