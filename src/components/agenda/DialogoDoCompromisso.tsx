import type { Dispatch, SetStateAction } from 'react'
import { Repeat, Users } from 'lucide-react'
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { GlassDialogContent } from '@/components/ui/glass-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { AgendaEscopo, AgendaGroup, AgendaImportancia } from '@/lib/supabase/types'
import type { StatusDaConexao } from '@/services/agenda_microsoft'
import { COR_AVISO_REPETE, PALETA_AGENDA } from './cores'
import type { ItemDaAgenda, Rascunho } from './tipos'

/**
 * Criar e editar compromisso — o MESMO diálogo para os dois.
 *
 * `editando` é o que decide: null cria, preenchido edita. Dois diálogos
 * separados duplicariam os oito campos, e o dia em que um ganhasse um campo
 * novo seria o dia em que os dois divergiriam.
 */
export function DialogoDoCompromisso({
  aberto,
  aoAbrirMudar,
  editando,
  rascunho,
  setRascunho,
  grupos,
  conexao,
  salvando,
  aoSalvar,
}: {
  aberto: boolean
  aoAbrirMudar: (aberto: boolean) => void
  editando: ItemDaAgenda | null
  rascunho: Rascunho
  setRascunho: Dispatch<SetStateAction<Rascunho>>
  grupos: AgendaGroup[]
  /**
   * O status inteiro, e não só `conectado`: a caixa de convidar precisa
   * distinguir "você ainda não ligou o seu Outlook" (a pessoa resolve na barra
   * de cima) de "o Outlook nem foi configurado no servidor" (aí é com quem
   * administra o 365, e insistir seria mandar a pessoa numa tarefa impossível).
   */
  conexao: StatusDaConexao
  salvando: boolean
  aoSalvar: () => void
}) {
  /*
    O convite do grupo já foi mandado alguma vez?

    Isso TRANCA a caixa marcada, pelo mesmo motivo que "Salvar no Outlook" fica
    trancada ao editar: desmarcar aqui significaria cancelar o compromisso na
    agenda de todo mundo que já aceitou — um clique de arrependimento disparando
    uma leva de cancelamentos. Para desfazer, o caminho é excluir o compromisso,
    que já cancela no Outlook e diz o que vai fazer antes.

    Marcar continua possível num compromisso de grupo que nasceu sem convite: aí
    não há nada para desfazer, só convite a mandar.
  */
  const conviteJaFeito = Boolean(editando?.outlook_event_id)
  // O evento fica na caixa de QUEM CRIOU, e o id dele só vale com o token dele.
  // Um admin editando o compromisso de outra pessoa não tem como convidar.
  const souDono = !editando || editando.souOCriador
  const podeMexerNoConvite = conexao.conectado && souDono && !conviteJaFeito

  // Quem fecha limpa o `editando` (fica com quem chama, em `aoAbrirMudar`):
  // sem isso, abrir "Novo" logo depois de editar reabriria em modo de edição e
  // salvaria por cima do compromisso errado.
  return (
    <Dialog open={aberto} onOpenChange={aoAbrirMudar}>
      <GlassDialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar compromisso' : 'Novo compromisso'}</DialogTitle>
        </DialogHeader>

        {/* Editar uma OCORRÊNCIA muda só aquele dia — a Microsoft transforma
            a ocorrência numa exceção da série. Dizer isso antes de salvar
            evita a descoberta na semana seguinte. */}
        {editando?.seRepete && (
          <p className={cn('flex items-start gap-2 rounded-lg border p-2.5 text-xs', COR_AVISO_REPETE)}>
            <Repeat className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Este compromisso se repete. O que você mudar aqui vale <b>só para este dia</b> —
              as outras datas continuam como estão.
            </span>
          </p>
        )}

        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ag-titulo">Título</Label>
            <Input
              id="ag-titulo"
              value={rascunho.titulo}
              onChange={(e) => setRascunho((r) => ({ ...r, titulo: e.target.value }))}
              placeholder="Reunião de fechamento"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ag-desc">Descrição</Label>
            <Textarea
              id="ag-desc"
              value={rascunho.descricao}
              onChange={(e) => setRascunho((r) => ({ ...r, descricao: e.target.value }))}
              placeholder="Detalhes, pauta, o que levar…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ag-inicio">Início</Label>
              <Input
                id="ag-inicio"
                type="datetime-local"
                value={rascunho.inicio}
                onChange={(e) => setRascunho((r) => ({ ...r, inicio: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ag-fim">Término</Label>
              <Input
                id="ag-fim"
                type="datetime-local"
                value={rascunho.fim}
                onChange={(e) => setRascunho((r) => ({ ...r, fim: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Importância</Label>
              <Select
                value={rascunho.importancia}
                onValueChange={(v) => setRascunho((r) => ({ ...r, importancia: v as AgendaImportancia }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baixa">Baixa</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label>Agenda</Label>
              <Select
                value={rascunho.escopo}
                onValueChange={(v) => setRascunho((r) => ({ ...r, escopo: v as AgendaEscopo }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usuario">Só minha</SelectItem>
                  <SelectItem value="setor">Do meu setor</SelectItem>
                  <SelectItem value="grupo">De um grupo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/*
            Cor de destaque — escolha da PESSOA, diferente de `importancia`
            (que é sinal do sistema). "Sem cor" primeiro e selecionado por
            padrão: a maioria dos compromissos não precisa de destaque, e sem
            essa opção não haveria como voltar atrás depois de escolher uma.
          */}
          <div className="grid gap-1.5">
            <Label>Cor</Label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setRascunho((r) => ({ ...r, cor: null }))}
                title="Sem cor"
                aria-label="Sem cor"
                aria-pressed={!rascunho.cor}
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/50 text-[11px] text-muted-foreground transition-transform hover:scale-110',
                  !rascunho.cor && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                )}
              >
                –
              </button>
              {PALETA_AGENDA.map((c) => (
                <button
                  key={c.valor}
                  type="button"
                  onClick={() => setRascunho((r) => ({ ...r, cor: c.valor }))}
                  title={c.nome}
                  aria-label={c.nome}
                  aria-pressed={rascunho.cor === c.valor}
                  className={cn(
                    'h-6 w-6 shrink-0 rounded-full border border-black/10 transition-transform hover:scale-110',
                    rascunho.cor === c.valor && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                  )}
                  style={{ backgroundColor: c.valor }}
                />
              ))}
            </div>
          </div>

          {/*
            Só na agenda pessoal: "setor" e "grupo" são conceitos nossos, que
            não existem no Outlook de ninguém.
          */}
          {rascunho.escopo === 'usuario' && conexao.conectado && (
            <label
              className={cn(
                'flex items-start gap-2.5 rounded-lg border border-border/60 bg-accent/30 p-3',
                editando ? 'cursor-default opacity-70' : 'cursor-pointer',
              )}
            >
              <Checkbox
                checked={rascunho.noOutlook}
                onCheckedChange={(v) => setRascunho((r) => ({ ...r, noOutlook: v === true }))}
                // Trancado ao editar: mudar de lado aqui significaria criar de
                // um lado e apagar do outro, e um erro no meio deixaria o
                // compromisso duplicado ou perdido. Para mover, é excluir e
                // criar de novo — explícito, e reversível a cada passo.
                disabled={Boolean(editando)}
                className="mt-0.5"
              />
              <span className="min-w-0 text-sm">
                Salvar no Outlook
                <span className="block text-xs text-muted-foreground">
                  {editando
                    ? 'Não dá para mudar de agenda ao editar. Para mover, exclua e crie de novo.'
                    : 'Vai para a sua agenda da Microsoft e aparece também no celular.'}
                </span>
              </span>
            </label>
          )}

          {rascunho.escopo === 'grupo' && (
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" /> Grupo
              </Label>
              <Select
                value={rascunho.groupId}
                onValueChange={(v) => setRascunho((r) => ({ ...r, groupId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={grupos.length ? 'Escolha o grupo' : 'Você ainda não tem grupos'} />
                </SelectTrigger>
                <SelectContent>
                  {grupos.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/*
            Convidar o grupo no Outlook — SÓ no escopo de grupo.

            É o oposto de "Salvar no Outlook" logo acima: aquele TIRA o
            compromisso da nossa agenda, este o mantém aqui e manda o convite
            por cima. Desmarcado, o compromisso de grupo continua funcionando
            como sempre funcionou — todo mundo do grupo o vê no Central Whats.
            Marcado, ele também cai na agenda da Microsoft de cada um, e aparece
            no celular deles sem passar por aqui.

            A caixa aparece mesmo desabilitada, e não some: um campo ausente não
            explica nada, e a pessoa ficaria procurando onde convida o grupo.
          */}
          {rascunho.escopo === 'grupo' && (
            <label
              className={cn(
                'flex items-start gap-2.5 rounded-lg border border-border/60 bg-accent/30 p-3',
                podeMexerNoConvite ? 'cursor-pointer' : 'cursor-default opacity-70',
              )}
            >
              <Checkbox
                checked={rascunho.convidarOutlook}
                onCheckedChange={(v) => setRascunho((r) => ({ ...r, convidarOutlook: v === true }))}
                disabled={!podeMexerNoConvite}
                className="mt-0.5"
              />
              <span className="min-w-0 text-sm">
                Convidar o grupo no Outlook
                <span className="block text-xs text-muted-foreground">
                  {!conexao.configurado
                    ? 'O Outlook ainda não foi configurado no servidor. Fale com quem administra o Microsoft 365.'
                    : !conexao.conectado
                      ? 'Conecte o seu Outlook na barra acima para poder convidar o grupo.'
                      : !souDono
                        ? 'Só quem criou pode convidar: o convite sai da caixa de correio de quem organiza.'
                        : conviteJaFeito
                          ? 'O grupo já foi convidado. Ao salvar, a lista é refeita com quem está no grupo agora. Para cancelar, exclua o compromisso.'
                          : 'Cai na agenda da Microsoft de cada pessoa do grupo. Quem ainda não conectou o Outlook continua vendo só por aqui.'}
                </span>
              </span>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ag-link">Link</Label>
              <Input
                id="ag-link"
                value={rascunho.link}
                onChange={(e) => setRascunho((r) => ({ ...r, link: e.target.value }))}
                placeholder="https://…"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ag-email">E-mail</Label>
              <Input
                id="ag-email"
                type="email"
                value={rascunho.email}
                onChange={(e) => setRascunho((r) => ({ ...r, email: e.target.value }))}
                placeholder="pessoa@prn.com"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => aoAbrirMudar(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={aoSalvar} disabled={salvando}>
            {salvando ? 'Salvando…' : editando ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </GlassDialogContent>
    </Dialog>
  )
}
