import { useMemo, useState } from 'react'
import { Copy, Loader2, Search } from 'lucide-react'
import { Botao, CLASSE_CONTROLE, Campo, Segmentado } from '../../components/ui'
import { EMPRESAS, validarIdentificacao, type Empresa, type FormNova } from '../../lib/unidadeNova'
import { normNome } from '../../nucleo/motor'
import type { UnidadeLista } from './useReferencias'

interface Props {
  form: FormNova
  unidades: UnidadeLista[]
  mostrarErros: boolean
  modo: 'zero' | 'duplicar'
  origemNome: string | null
  carregandoOrigem: boolean
  erroOrigem: string | null
  onModo: (m: 'zero' | 'duplicar') => void
  onDuplicarDe: (u: UnidadeLista) => void
  onChange: (p: Partial<FormNova>) => void
}

export function PassoIdentificacao({ form, unidades, mostrarErros, modo, origemNome, carregandoOrigem, erroOrigem, onModo, onDuplicarDe, onChange }: Props) {
  const [busca, setBusca] = useState('')
  const v = validarIdentificacao(form, unidades)
  const achadas = useMemo(() => {
    const b = normNome(busca)
    if (!b) return []
    return unidades.filter(u => normNome(u.pasta).includes(b) || normNome(u.orgao ?? '').includes(b)).slice(0, 8)
  }, [busca, unidades])
  const erro = (k: string) => (mostrarErros || form.pasta ? v.erros[k] : undefined)
  const txt = (k: 'orgao' | 'numero_contrato' | 'vigencia_inicio' | 'vigencia_fim') => ({
    value: form[k], onChange: (e: { target: { value: string } }) => onChange({ [k]: e.target.value }), className: CLASSE_CONTROLE,
  })

  return (
    <div className="space-y-5">
      <Segmentado nome="modo" rotulo="Como criar" valor={modo} onChange={m => onModo(m as 'zero' | 'duplicar')} opcoes={[
        { valor: 'zero', rotulo: 'Começar do zero', descricao: 'Preencho tudo em branco' },
        { valor: 'duplicar', rotulo: 'Duplicar a partir de outra unidade', descricao: 'Copia regras e preços de hoje (sem termos nem nomes)' },
      ]} />

      {modo === 'duplicar' && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <Campo rotulo="Unidade de origem" ajuda="Os preços entram já no valor vigente de hoje. Termos, nomes da Mobilemed e pendências não são copiados.">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-500" aria-hidden="true" />
              <input type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Busque pela pasta ou pelo órgão" className={`${CLASSE_CONTROLE} pl-8`} />
            </div>
          </Campo>
          {achadas.length > 0 && (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
              {achadas.map(u => (
                <li key={u.id}>
                  <button type="button" onClick={() => { onDuplicarDe(u); setBusca('') }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50">
                    <span className="min-w-0 truncate font-medium text-slate-800">{u.pasta}</span>
                    <span className="shrink-0 text-xs text-slate-600">{u.empresa}{u.orgao ? ` · ${u.orgao}` : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busca && achadas.length === 0 && <p className="text-xs text-slate-600">Nenhuma unidade encontrada.</p>}
          {carregandoOrigem && <p className="flex items-center gap-2 text-sm text-slate-700"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Lendo a unidade de origem…</p>}
          {erroOrigem && <p role="alert" className="text-sm text-rose-700">Não foi possível ler a origem: {erroOrigem}</p>}
          {origemNome && !carregandoOrigem && (
            <p className="flex items-center gap-2 text-sm text-emerald-800"><Copy className="size-4" aria-hidden="true" />Copiado de <strong>{origemNome}</strong>. Informe a nova pasta abaixo e confira os próximos passos.</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Empresa">
          <select value={form.empresa} onChange={e => onChange({ empresa: e.target.value as Empresa })} className={CLASSE_CONTROLE}>
            {EMPRESAS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Pasta (nome da unidade)" erro={erro('pasta')} ajuda="Igual à pasta do contrato. Não pode repetir dentro da mesma empresa.">
          <input value={form.pasta} onChange={e => onChange({ pasta: e.target.value })} className={CLASSE_CONTROLE} />
        </Campo>
        <Campo rotulo="Órgão contratante"><input {...txt('orgao')} /></Campo>
        <Campo rotulo="Nº do contrato"><input {...txt('numero_contrato')} /></Campo>
        <Campo rotulo="Início da vigência"><input type="date" {...txt('vigencia_inicio')} /></Campo>
        <Campo rotulo="Fim da vigência" erro={v.erros.vigencia_fim}><input type="date" {...txt('vigencia_fim')} /></Campo>
      </div>
      {v.avisos.map((a, i) => <p key={i} role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{a}</p>)}
      {modo === 'duplicar' && origemNome && <Botao variante="fantasma" tamanho="pequeno" onClick={() => onModo('zero')}>Limpar e começar do zero</Botao>}
    </div>
  )
}
