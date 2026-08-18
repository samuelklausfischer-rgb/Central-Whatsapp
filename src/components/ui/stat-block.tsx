/**
 * `StatBlock` — N números lado a lado num único `GlassCard`.
 *
 * Telas como `settings/InstancesSettings.tsx` (linhas ~538-552: total,
 * conectadas, desconectadas, não importadas) desenhavam isso como 4 `Card`
 * irmãos. Quatro superfícies de vidro coladas por quatro números é ruído
 * visual (cada uma repete borda + sombra + linha de luz do vidro por nada) e
 * custo de GPU sem ganho nenhum — um `GlassCard` só, com divisores finos
 * entre as colunas, comunica a mesma informação com um blur em vez de
 * quatro.
 *
 * `ACENTOS` mora aqui e não em `Index.tsx` (de onde foi movido): é o mesmo
 * vocabulário de cor que os `KpiCard` da home usam para o ícone e o bloom, e
 * agora vira também a cor do número em `StatBlock`. Um mapa só, reaproveitado
 * pelos dois formatos de "número agrupado" do app.
 */
import * as React from 'react'

import { CardContent } from '@/components/ui/card'
import { GlassCard } from '@/components/ui/surface'
import { cn } from '@/lib/utils'

/**
 * Antes cada KpiCard recebia `accentBg`/`accentText` soltos — dois valores que
 * precisavam ficar em sincronia na mão a cada card novo, e `accentText` era
 * passado e nunca lido em lugar nenhum (morto desde sempre). Um mapa único por
 * nome de cor garante que o bloom do fundo e o tom do ícone sempre casem, e
 * mata de vez o `bg-opacity-10` (utilitário legado que quebra silenciosamente
 * quando combinado com cor gerada em runtime).
 */
export const ACENTOS = {
  azul: { icone: 'text-blue-500', bloom: 'radial-gradient(circle, rgb(59 130 246 / 0.35), transparent 70%)' },
  esmeralda: { icone: 'text-emerald-500', bloom: 'radial-gradient(circle, rgb(16 185 129 / 0.35), transparent 70%)' },
  violeta: { icone: 'text-violet-500', bloom: 'radial-gradient(circle, rgb(139 92 246 / 0.35), transparent 70%)' },
  ambar: { icone: 'text-amber-500', bloom: 'radial-gradient(circle, rgb(245 158 11 / 0.35), transparent 70%)' },
  rosa: { icone: 'text-rose-500', bloom: 'radial-gradient(circle, rgb(244 63 94 / 0.35), transparent 70%)' },
} satisfies Record<string, { icone: string; bloom: string }>

export interface StatBlockItem {
  label: string
  /** Aceita string pronta (ex.: já formatada) ou número — número passa por
   * `toLocaleString('pt-BR')` automaticamente, igual ao `KpiCard` da home. */
  value: number | string
  /** Cor do valor. Omitir usa `text-foreground` (neutro). */
  acento?: keyof typeof ACENTOS
}

export function StatBlock({
  itens, className,
}: {
  itens: StatBlockItem[]
  className?: string
}) {
  return (
    <GlassCard className={cn('overflow-hidden', className)}>
      <CardContent className="p-0">
        {/* `gridTemplateColumns` via `style` em vez de `grid-cols-N` do
            Tailwind: N é dinâmico (número de itens varia por tela) e o
            Tailwind não gera classe para um número arbitrário em runtime. */}
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}
        >
          {itens.map((item, i) => (
            <div
              key={item.label}
              className={cn(
                'px-4 py-4 text-center sm:text-left',
                // Divisor sutil entre colunas — nada no primeiro item.
                i > 0 && 'border-l border-border/50',
              )}
            >
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {item.label}
              </p>
              <p
                className={cn(
                  'text-2xl font-semibold tracking-tight tabular-nums',
                  item.acento ? ACENTOS[item.acento].icone : 'text-foreground',
                )}
              >
                {typeof item.value === 'number' ? item.value.toLocaleString('pt-BR') : item.value}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </GlassCard>
  )
}
