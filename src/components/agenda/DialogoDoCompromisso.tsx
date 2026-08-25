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
import { COR_AVISO_REPETE } from './cores'
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
  conexaoConectada,
  salvando,
  aoSalvar,
}: {
  aberto: boolean
  aoAbrirMudar: (aberto: boolean) => void
  editando: ItemDaAgenda | null
  rascunho: Rascunho
  setRascunho: Dispatch<SetStateAction<Rascunho>>
  grupos: AgendaGroup[]
  conexaoConectada: boolean
  salvando: boolean
  aoSalvar: () => void
}) {
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
            Só na agenda pessoal: "setor" e "grupo" são conceitos nossos, que
            não existem no Outlook de ninguém.
          */}
          {rascunho.escopo === 'usuario' && conexaoConectada && (
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
