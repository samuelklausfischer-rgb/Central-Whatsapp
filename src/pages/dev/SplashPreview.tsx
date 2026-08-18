/* Harness de dev para validar o UpdatePanel/AuthShell sem depender de um update
   de verdade. `main.cjs:53` só checa updates fora de dev, então
   `npm run dev:electron` nunca produz `downloading` nem `ready` — os dois
   estados mais importantes de conferir antes de publicar para a frota. Esta
   página monta AuthShell + UpdatePanel com um estado FALSO e controlável, para
   dar para ver os cinco estados e as seis artes de fundo sem esperar um
   release real. Só existe em dev: ver o guard `import.meta.env.DEV` em
   App.tsx, que impede o registro da rota (e o próprio import lazy) em
   produção. */
import { useState } from 'react'
import { Shuffle } from 'lucide-react'

import { AuthShell } from '@/components/auth/AuthShell'
import { UpdatePanel } from '@/components/UpdatePanel'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { galeria } from '@/lib/backgrounds'
import type { UpdateStatus } from '@/hooks/use-updater'

// Só os 5 estados pedidos no harness — `idle`/`up-to-date` não têm visual
// próprio interessante de conferir aqui (o UpdatePanel trata os dois como o
// mesmo anel de "checking" ou como o discreto "Só um instante…").
type EstadoSimulado = 'checking' | 'available' | 'downloading' | 'ready' | 'error'

// Versão fictícia só para preencher os campos do UpdateStatus nos estados que
// exigem `version` — não vem de lugar nenhum real, é só para o painel ter algo
// para mostrar.
const VERSAO_FALSA = '0.0.212'

export default function SplashPreview() {
  const [estado, setEstado] = useState<EstadoSimulado>('checking')
  // Um slider só, reaproveitado: `percent` do downloading e
  // `progressoDaVerificacao` do checking nunca aparecem ao mesmo tempo, então
  // não precisa de dois controles — só muda o rótulo conforme o estado ativo.
  const [progresso, setProgresso] = useState(40)
  const [indiceDaArte, setIndiceDaArte] = useState(0)

  const arteAtual = galeria[indiceDaArte]

  const status: UpdateStatus = (() => {
    switch (estado) {
      case 'available':
        return { type: 'available', version: VERSAO_FALSA }
      case 'downloading':
        return { type: 'downloading', percent: progresso }
      case 'ready':
        return { type: 'ready', version: VERSAO_FALSA }
      case 'error':
        return { type: 'error', message: 'Falha simulada — só para conferir o estado visual.' }
      case 'checking':
      default:
        return { type: 'checking' }
    }
  })()

  return (
    <>
      {/* `background` passado explícito de propósito — é justamente para
          este harness trocar a arte sem depender do sorteio por abertura que
          `backgroundDaAbertura` faz no app de verdade. */}
      <AuthShell background={arteAtual}>
        <UpdatePanel
          status={status}
          version={VERSAO_FALSA}
          progressoDaVerificacao={progresso}
          onInstall={() => console.log('[dev/splash] onInstall chamado (harness, sem efeito real)')}
        />
      </AuthShell>

      {/* Barra fixa no rodapé, fundo escuro sólido: os controles precisam ficar
          legíveis por cima de qualquer uma das seis fotos, claras ou escuras. */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center gap-4 bg-black/85 p-4 text-sm text-white backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-white/70">Estado</span>
          <Select value={estado} onValueChange={(v) => setEstado(v as EstadoSimulado)}>
            <SelectTrigger className="h-9 w-[160px] bg-white/10 text-white border-white/25">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="checking">checking</SelectItem>
              <SelectItem value="available">available</SelectItem>
              <SelectItem value="downloading">downloading</SelectItem>
              <SelectItem value="ready">ready</SelectItem>
              <SelectItem value="error">error</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(estado === 'checking' || estado === 'downloading') && (
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <span className="whitespace-nowrap text-white/70">
              {estado === 'downloading' ? 'percent' : 'progressoDaVerificacao'}
            </span>
            <Slider
              value={[progresso]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => setProgresso(v)}
              className="max-w-xs"
            />
            <span className="w-10 tabular-nums text-white/70">{progresso}</span>
          </div>
        )}

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setIndiceDaArte((i) => (i + 1) % galeria.length)}
        >
          <Shuffle className="mr-2 h-4 w-4" /> Sortear outra arte
        </Button>

        <span className="text-white/70">
          {arteAtual.nome} · lado da esfera: <strong className="text-white">{arteAtual.ladoDaEsfera}</strong>
        </span>
      </div>
    </>
  )
}
