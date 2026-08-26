import { useEffect, useState } from 'react'
import { Users, Plus, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { listarSetores, listarPessoas, definirMembrosDoSetor, type Pessoa, type Setor } from '@/services/setores'

/**
 * Quem participa de cada setor.
 *
 * Mora aqui, junto do e-mail, porque é aqui que a consequência aparece: o setor
 * de uma caixa decide quem a enxerga. Um setor sem ninguém dentro faz a caixa
 * ficar visível só para administradores — e é exatamente esse silêncio que este
 * bloco existe para quebrar, mostrando a contagem de gente ao lado de cada um.
 *
 * Não existe "criar setor" separado de "pôr gente nele": o setor nasce quando a
 * primeira pessoa entra e some quando a última sai. Ver `services/setores.ts`.
 */
export default function GerenciadorDeSetores({ aoMudar }: { aoMudar?: () => void }) {
  const { toast } = useToast()
  const [setores, setSetores] = useState<Setor[]>([])
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [novoNome, setNovoNome] = useState('')

  const [editando, setEditando] = useState<string | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [salvando, setSalvando] = useState(false)

  const carregar = async () => {
    try {
      const [s, p] = await Promise.all([listarSetores(), listarPessoas()])
      setSetores(s)
      setPessoas(p)
    } catch (err) {
      console.error(err)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  const abrir = (nome: string) => {
    setEditando(nome)
    setMarcados(new Set(setores.find((s) => s.nome === nome)?.membros ?? []))
  }

  const criar = (ev: React.FormEvent) => {
    ev.preventDefault()
    const nome = novoNome.trim()
    if (!nome) return
    if (setores.some((s) => s.nome.toLowerCase() === nome.toLowerCase())) {
      toast({ title: 'Esse setor já existe', variant: 'destructive' })
      return
    }
    // Abre direto o seletor de gente: um setor sem ninguém não existe de fato.
    setEditando(nome)
    setMarcados(new Set())
  }

  const salvar = async () => {
    if (!editando) return
    setSalvando(true)
    try {
      await definirMembrosDoSetor(editando, [...marcados])
      toast({ title: `Setor ${editando} atualizado` })
      setEditando(null)
      setNovoNome('')
      await carregar()
      aoMudar?.()
    } catch (err) {
      toast({
        title: 'Não deu para salvar o setor',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setSalvando(false)
    }
  }

  const alternar = (id: string) => {
    setMarcados((antes) => {
      const novo = new Set(antes)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })
  }

  const nomeDaPessoa = (p: Pessoa) => p.name || p.email || 'sem nome'

  return (
    <GlassCard>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="h-5 w-5" />
          Setores e quem participa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          O setor de uma caixa decide quem enxerga aqueles e-mails. Setor sem ninguém dentro deixa
          a caixa visível só para administradores.
        </p>

        <div className="space-y-2">
          {setores.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum setor cadastrado ainda.</p>
          )}
          {setores.map((s) => (
            <div
              key={s.nome}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.nome}</span>
                <Badge variant={s.membros.length === 0 ? 'destructive' : 'secondary'}>
                  {s.membros.length === 1 ? '1 pessoa' : `${s.membros.length} pessoas`}
                </Badge>
              </div>
              <Button variant="outline" size="sm" onClick={() => abrir(s.nome)}>
                <Pencil className="mr-2 h-4 w-4" />
                Quem participa
              </Button>
            </div>
          ))}
        </div>

        <form onSubmit={criar} className="flex flex-wrap gap-2">
          <Input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Nome do setor novo (ex.: Laudos)"
            className="max-w-xs"
            autoComplete="off"
          />
          <Button type="submit" variant="outline" disabled={!novoNome.trim()}>
            <Plus className="mr-2 h-4 w-4" />
            Criar setor
          </Button>
        </form>
      </CardContent>

      <Dialog open={editando !== null} onOpenChange={(aberto) => !aberto && setEditando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quem participa de {editando}</DialogTitle>
            <DialogDescription>
              Estas pessoas passam a ver as caixas de e-mail deste setor — inclusive as mensagens
              que já chegaram antes.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-72 pr-3">
            <div className="space-y-1">
              {pessoas.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted/50"
                >
                  <Checkbox checked={marcados.has(p.id)} onCheckedChange={() => alternar(p.id)} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{nomeDaPessoa(p)}</span>
                    {p.email && (
                      <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </ScrollArea>

          {marcados.size === 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-500">
              Sem ninguém marcado o setor deixa de existir, e as caixas dele ficam visíveis só para
              administradores.
            </p>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassCard>
  )
}
