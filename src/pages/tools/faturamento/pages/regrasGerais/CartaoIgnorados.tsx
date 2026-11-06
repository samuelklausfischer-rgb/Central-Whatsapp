import { useState } from 'react'
import { EyeOff, Plus, Trash2, Loader2 } from 'lucide-react'
import { normNome } from '../../nucleo/motor'
import { db } from '../../lib/supabase'
import { baixarBackup, capturar, guardarUltimo, type Backup } from '../../lib/backup'
import { AvisoDesfazer, Botao, Campo, Cartao, ConfirmarApagar, Vazio } from '../../components/ui'
import { CLASSE_CONTROLE } from '../../components/ui/Campo'
import { nomeExibicao } from '../../lib/format'
import type { AliasCad, IgnoradoCad, UnidadeCad } from '../../lib/diagnostico'

/** Nomes ignorados: listar, adicionar e remover (remover = leve, com backup baixado e desfazer). */
export function CartaoIgnorados({ ignorados, aliases, unidades, onMudou }: {
  ignorados: IgnoradoCad[]; aliases: AliasCad[]; unidades: UnidadeCad[]; onMudou: () => void
}) {
  const [nome, setNome] = useState('')
  const [motivo, setMotivo] = useState('')
  const [gravando, setGravando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [apagando, setApagando] = useState<string | null>(null)
  const [backup, setBackup] = useState<Backup | null>(null)

  const unidadeDoNome = (n: string) => {
    const a = aliases.find(x => normNome(x.nome_bruto) === normNome(n))
    return a ? unidades.find(u => u.id === a.unidade_id) : undefined
  }
  const ordenados = [...ignorados].sort((a, b) => a.nome_bruto.localeCompare(b.nome_bruto, 'pt-BR'))
  const repetido = !!nome.trim() && ignorados.some(i => normNome(i.nome_bruto) === normNome(nome))
  const ligado = nome.trim() ? unidadeDoNome(nome) : undefined

  async function adicionar() {
    setGravando(true); setErro(null)
    const { error } = await db.from('nome_ignorado').insert({ nome_bruto: nome.trim(), motivo: motivo.trim() })
    setGravando(false)
    if (error) { setErro(error.message); return }
    setNome(''); setMotivo(''); onMudou()
  }

  async function apagar(i: IgnoradoCad) {
    const linhas = await capturar('nome_ignorado', 'nome_bruto', [i.nome_bruto])
    const b: Backup = { versao: 1, criadoEm: new Date().toISOString(), descricao: `nome-ignorado-${i.nome_bruto}`, tabelas: [{ tabela: 'nome_ignorado', linhas }] }
    baixarBackup(b)
    guardarUltimo(b)
    const { error } = await db.from('nome_ignorado').delete().eq('nome_bruto', i.nome_bruto)
    if (error) throw new Error(error.message)
    setBackup(b); setApagando(null); onMudou()
  }

  return (
    <Cartao titulo="Nomes ignorados" icone={EyeOff} cor="slate"
      descricao="Nome da Mobilemed que nunca é faturado, mesmo se tiver unidade ligada. O ignorado vence sempre.">
      {backup && <div className="mb-4"><AvisoDesfazer backup={backup} onDesfeito={() => { setBackup(null); onMudou() }} /></div>}

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Campo rotulo="Nome na Mobilemed" erro={repetido ? 'Esse nome já está na lista.' : undefined}>
          <input className={CLASSE_CONTROLE} value={nome} onChange={e => setNome(e.target.value)} />
        </Campo>
        <Campo rotulo="Motivo" ajuda="Obrigatório.">
          <input className={CLASSE_CONTROLE} value={motivo} onChange={e => setMotivo(e.target.value)} />
        </Campo>
        <Botao variante="primario" icone={gravando ? Loader2 : Plus} disabled={!nome.trim() || !motivo.trim() || repetido || gravando} onClick={() => void adicionar()}>Adicionar</Botao>
        {ligado && <p className="text-xs text-amber-900 sm:col-span-3">Atenção: este nome está ligado a “{nomeExibicao(ligado.pasta)}”. Ignorando, ele deixa de ser faturado por ela.</p>}
        {erro && <p role="alert" className="text-xs font-medium text-rose-700 sm:col-span-3">Não foi possível gravar: {erro}</p>}
      </div>

      {ordenados.length === 0 ? (
        <div className="mt-4"><Vazio icone={EyeOff} titulo="Nenhum nome ignorado" /></div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {ordenados.map(i => {
            const u = unidadeDoNome(i.nome_bruto)
            return (
              <li key={i.nome_bruto} className="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900">{i.nome_bruto}</p>
                    <p className="text-xs text-slate-600">{i.motivo || 'sem motivo'}</p>
                  </div>
                  <Botao tamanho="pequeno" variante="fantasma" icone={Trash2} onClick={() => setApagando(apagando === i.nome_bruto ? null : i.nome_bruto)}>Remover</Botao>
                </div>
                {apagando === i.nome_bruto && (
                  <div className="mt-2">
                    <ConfirmarApagar nivel="leve" titulo={`Remover “${i.nome_bruto}” da lista de ignorados?`}
                      efeitos={[u ? `“${i.nome_bruto}” volta a ser faturado por “${nomeExibicao(u.pasta)}”.` : `“${i.nome_bruto}” volta a aparecer como unidade desconhecida no relatório.`, 'Uma cópia de segurança é baixada antes.']}
                      onConfirmar={() => apagar(i)} onCancelar={() => setApagando(null)} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Cartao>
  )
}
