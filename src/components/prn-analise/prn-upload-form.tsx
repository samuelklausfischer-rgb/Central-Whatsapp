import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Calendar as CalendarIcon, Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FileUploadDropzone } from '@/components/prn-analise/prn-file-dropzone'
import { HistoricalFileSelector } from '@/components/prn-analise/historical-file-selector'
import { cn } from '@/lib/utils'

const MAX_FILE_SIZE = 10 * 1024 * 1024

export const formSchema = z.object({
  reference_date: z.date().optional(),
  daily_file: z
    .any()
    .refine((files) => files?.length === 1, 'Arquivo diário é obrigatório.')
    .refine((files) => files?.[0]?.size <= MAX_FILE_SIZE, 'O tamanho máximo do arquivo é 10MB.'),
  historical_files: z.any().refine((val) => {
    const saved = Array.isArray(val?.saved) ? val.saved : []
    return saved.length > 0
  }, 'Selecione ao menos um arquivo histórico no cofre.'),
})

/** Numerozinho que marca a ordem dos passos do formulário. */
function StepBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
      {children}
    </span>
  )
}

export function PrnUploadForm({ onSubmit }: { onSubmit: (v: z.infer<typeof formSchema>) => void }) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      // Já vem com o dia em que a página foi aberta — que é o caso normal.
      // O formulário é remontado a cada nova análise (key={formKey} na página),
      // então a data se renova sozinha. Continua editável pelo calendário.
      reference_date: new Date(),
      historical_files: {
        saved: [],
      },
    },
  })

  const hasDailyFile = !!form.watch('daily_file')?.[0]
  const historicalFilesVal = form.watch('historical_files')
  const hasHistoricalFile = Array.isArray(historicalFilesVal?.saved) && historicalFilesVal.saved.length > 0
  const isSubmitDisabled = !hasDailyFile || !hasHistoricalFile

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-10">
        <FormField
          control={form.control}
          name="reference_date"
          render={({ field }) => (
            <FormItem className="flex flex-col space-y-3">
              <FormLabel className="text-gray-800 font-bold text-sm uppercase tracking-widest flex items-center gap-2">
                <StepBadge>1</StepBadge>
                Data de Referência
              </FormLabel>
              <p className="text-sm text-gray-500">
                Já vem preenchida com a data de hoje. Só mude se a análise for de outro dia.
              </p>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      variant={'outline'}
                      className={cn(
                        'w-full max-w-md pl-4 text-left font-bold border-gray-200 h-14 rounded-2xl bg-gray-50 hover:bg-gray-100 hover:border-gray-300 transition-all',
                        !field.value && 'text-gray-400',
                        field.value && 'text-blue-600 border-blue-300 bg-blue-50'
                      )}
                    >
                      {field.value ? (
                        <span>
                          {format(field.value, 'PPP', { locale: ptBR })}
                        </span>
                      ) : (
                        <span>Defina a data base da análise</span>
                      )}
                      <CalendarIcon className="ml-auto h-5 w-5 opacity-40" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0 bg-white border-gray-200 shadow-lg" align="start">
                  <Calendar
                    mode="single"
                    selected={field.value}
                    onSelect={field.onChange}
                    disabled={(date) => date > new Date() || date < new Date('2000-01-01')}
                    initialFocus
                    className="rounded-2xl"
                  />
                </PopoverContent>
              </Popover>
              <FormMessage className="text-red-500 text-xs font-bold uppercase" />
            </FormItem>
          )}
        />

        {/* Passo principal: é aqui que a pessoa erra menos se o bloco gritar. */}
        <div className="rounded-3xl border-2 border-blue-200 bg-blue-50/40 p-6 md:p-8">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-800">
            <StepBadge>2</StepBadge>
            Arquivo Diário
          </div>
          <p className="mb-5 text-sm text-gray-600">
            A planilha com os <b>pagamentos lançados no dia</b> — é ela que será comparada com o histórico.
          </p>
          <FormField
            control={form.control}
            name="daily_file"
            render={({ field }) => <FileUploadDropzone field={field} />}
          />
        </div>

        <FormField
          control={form.control}
          name="historical_files"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel className="text-gray-800 font-bold text-sm uppercase tracking-widest flex items-center gap-2">
                <StepBadge>3</StepBadge>
                Arquivo Histórico
              </FormLabel>
              <p className="text-sm text-gray-500">
                As bases dos meses anteriores que servem de comparação. O cruzamento usa os 3 meses mais recentes.
              </p>
              <FormControl>
                <HistoricalFileSelector value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage className="text-red-500 text-xs font-bold uppercase" />
            </FormItem>
          )}
        />

        <div className="pt-8 border-t border-gray-100 flex justify-end">
          <Button
            type="submit"
            className={cn(
              "h-14 px-10 rounded-2xl font-bold text-base transition-all active:scale-[0.98] shadow-sm",
              !isSubmitDisabled
                ? "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20"
                : "bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed"
            )}
            disabled={isSubmitDisabled}
          >
            <Play className={cn("mr-2 h-5 w-5 fill-current", !isSubmitDisabled ? "text-white" : "text-gray-300")} />
            Iniciar Motor de Regras
          </Button>
        </div>
      </form>
    </Form>
  )
}
