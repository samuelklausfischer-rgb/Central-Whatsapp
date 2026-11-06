import { useCallback, useEffect, useState } from 'react'
import { Link } from '../navegacao'
import { Archive, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react'
import { Botao, CLASSE_CONTROLE, Campo } from './ui'
import { AvisoDesfazer, ConfirmarApagar } from './ui/ConfirmarApagar'
import { hojeISO, plural } from '../lib/format'
import {
  apagarUnidade, contarEfeitos, encerrarUnidade, nomesDaUnidade, nomesEncerrados, reativarUnidade, type Efeitos,
} from '../lib/apagarUnidade'
import type { Backup } from '../lib/backup'
import type { UnidadeResumo } from '../lib/tipos'

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function efeitosEmTexto(e: Efeitos): string[] {
  return [
    plural(e.itens, 'preço', 'preços'),
    plural(e.termos, 'termo (aditivo)', 'termos (aditivos)'),
    plural(e.nomes, 'nome da Mobilemed', 'nomes da Mobilemed'),
    plural(e.pendencias, 'pendência', 'pendências'),
    plural(e.relatorios, 'relatório perde o vínculo com a unidade', 'relatórios perdem o vínculo com a unidade'),
  ]
}

interface Props { unidade: UnidadeResumo; onMudou: () => void }

/** Cartão "Zona de perigo": encerrar e parar de faturar (reversível) ou apagar a unidade (com backup). */
export function ZonaPerigoUnidade({ unidade, onMudou }: Props) {
  const [nomes, setNomes] = useState<string[]>([])
  const [ignorados, setIgnorados] = useState<string[]>([])
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [apagando, setApagando] = useState<Efeitos | 'carregando' | null>(null)
  const [backup, setBackup] = useState<Backup | null>(null)
  const encerrada = unidade.situacao === 'encerrado'

  const carregar = useCallback(async () => {
    try {
      const [n, i] = await Promise.all([nomesDaUnidade(unidade.id), nomesEncerrados(unidade.id, unidade.pasta)])
      setNomes(n); setIgnorados(i)
    } catch (e) { setErro(msg(e)) }
  }, [unidade.id, unidade.pasta])
  useEffect(() => { if (!backup) void carregar() }, [carregar, backup, unidade.situacao])

  async function executar(fn: () => Promise<void>) {
    setOcupado(true); setErro(null)
    try { await fn(); await carregar(); onMudou() } catch (e) { setErro(msg(e)) } finally { setOcupado(false) }
  }

  async function pedirApagar() {
    setApagando('carregando'); setErro(null)
    try { setApagando(await contarEfeitos(unidade.id)) } catch (e) { setErro(msg(e)); setApagando(null) }
  }

  // Depois de apagada, a tela da unidade não existe mais: só o aviso com Desfazer e o caminho de volta.
  if (backup) {
    return (
      <section aria-label="Unidade apagada" className="space-y-3 rounded-xl border border-rose-200 bg-rose-50/40 p-5">
        <AvisoDesfazer backup={backup} onDesfeito={() => { setBackup(null); onMudou() }} />
        <Link to="/faturamento" className="inline-flex text-sm font-medium text-[#1f4e78] underline">Voltar à lista de unidades</Link>
      </section>
    )
  }

  const nomesAtivos = nomes.filter(n => !ignorados.includes(n))
  return (
    <section id="encerrar" aria-labelledby="zona-perigo-titulo" className="scroll-mt-20 space-y-5 rounded-xl border border-rose-200 bg-rose-50/40 p-5">
      <header className="flex items-start gap-3">
        <span className="rounded-lg bg-rose-100 p-2 text-rose-700" aria-hidden="true"><ShieldAlert className="size-5" /></span>
        <div>
          <h2 id="zona-perigo-titulo" className="text-base font-semibold text-rose-900">Zona de perigo</h2>
          <p className="text-sm text-rose-900/80">Encerrar é o caminho normal. Apagar só se a unidade foi criada por engano.</p>
        </div>
      </header>

      {erro && <p role="alert" className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm text-rose-800">{erro}</p>}

      <div className="space-y-2 rounded-lg border border-rose-100 bg-white p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Archive className="size-4" aria-hidden="true" />Encerrar e parar de faturar</h3>
        {encerrada ? (
          <>
            <p className="text-sm text-slate-700">Esta unidade está encerrada{unidade.motivo_situacao ? ` (${unidade.motivo_situacao})` : ''}.{ignorados.length > 0 ? ' Estes nomes estão sendo ignorados e não faturam:' : ' Os nomes dela continuam faturando.'}</p>
            {ignorados.length > 0 && <NomesLista nomes={ignorados} />}
            <Botao icone={RotateCcw} disabled={ocupado} onClick={() => void executar(() => reativarUnidade(unidade.id, unidade.pasta, hojeISO()))}>
              {ocupado ? 'Reativando…' : 'Reativar'}
            </Botao>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-700">A unidade fica como “encerrada” e os nomes dela entram na lista de nomes ignorados. Preços, termos e histórico continuam guardados. Dá para reativar depois.</p>
            {nomesAtivos.length > 0
              ? <><p className="text-xs font-medium text-slate-700">Nomes que deixam de faturar ({nomesAtivos.length}):</p><NomesLista nomes={nomesAtivos} /></>
              : <p className="text-xs text-slate-600">Esta unidade não tem nomes da Mobilemed cadastrados.</p>}
            <Campo rotulo="Motivo do encerramento (obrigatório)">
              <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: contrato rescindido em 10/2026" className={CLASSE_CONTROLE} />
            </Campo>
            <div className="flex flex-wrap gap-2">
              <Botao variante="perigo" icone={Archive} disabled={ocupado || !motivo.trim()} onClick={() => void executar(async () => { await encerrarUnidade(unidade.id, motivo, true); setMotivo('') })}>
                {ocupado ? 'Encerrando…' : 'Encerrar e parar de faturar'}
              </Botao>
              <Botao disabled={ocupado || !motivo.trim()} onClick={() => void executar(async () => { await encerrarUnidade(unidade.id, motivo, false); setMotivo('') })}>
                Só marcar como encerrada (continua faturando)
              </Botao>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-rose-100 bg-white p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Trash2 className="size-4" aria-hidden="true" />Apagar unidade</h3>
        {apagando === null && (
          <>
            <p className="text-sm text-slate-700">Apaga a unidade e tudo que depende dela. Antes, o sistema baixa um arquivo de backup e permite desfazer enquanto a aba estiver aberta.</p>
            <Botao variante="perigo" icone={Trash2} disabled={ocupado} onClick={() => void pedirApagar()}>Apagar esta unidade…</Botao>
          </>
        )}
        {apagando === 'carregando' && <p className="text-sm text-slate-600">Contando o que será apagado…</p>}
        {apagando && apagando !== 'carregando' && (
          apagando.instrucoes > 0 ? (
            <ConfirmarApagar nivel="bloqueado" titulo="Esta unidade não pode ser apagada por aqui"
              efeitos={[`Ela tem ${plural(apagando.instrucoes, 'instrução de NF', 'instruções de NF')}, que seriam apagadas junto e não podem ser recriadas por este app.`]}
              alternativa={<>Use <strong>Encerrar e parar de faturar</strong> acima, ou apague pelo Central Whats.</>}
              onConfirmar={async () => undefined} onCancelar={() => setApagando(null)} />
          ) : (
            <ConfirmarApagar nivel="pesado" titulo={`Apagar “${unidade.pasta}”? Isto vai junto:`} efeitos={efeitosEmTexto(apagando)} confirmarCom={unidade.pasta}
              onConfirmar={async () => { setBackup(await apagarUnidade(unidade.id)); setApagando(null) }} onCancelar={() => setApagando(null)} />
          )
        )}
      </div>
    </section>
  )
}

function NomesLista({ nomes }: { nomes: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {nomes.map(n => <li key={n} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800">{n}</li>)}
    </ul>
  )
}
