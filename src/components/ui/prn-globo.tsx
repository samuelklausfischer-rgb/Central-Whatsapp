import globo from '@/assets/prn-globo.png'
import { cn } from '@/lib/utils'

/**
 * Globo do PRN Hub — só os ladrilhos azuis, sem a placa branca do ícone de
 * app, para caber num avatar circular (~20-32px) sem mostrar um quadrado
 * branco atrás do círculo.
 *
 * Fonte única: `src/assets/prn-globo.png`, recortado por
 * `scripts/gerar-marca.mjs` (etapa A-2) direto da arte real da marca
 * (`brand/prnhub-icone.png`). Antes disso existiam DUAS versões do logo — a
 * arte real, usada nos ícones de app, e este globo, redesenhado à mão em SVG
 * — e era preciso lembrar de editar as duas em conjunto. Agora há um único
 * arquivo de origem, e este componente só o exibe.
 *
 * Import ESTÁTICO (não um caminho de string tipo `/prn-globo.png`): o build
 * do Electron roda `vite build --base ./`, e o Vite só reescreve para um
 * caminho relativo ao bundle os imports que ele processa em build. Uma
 * string montada em runtime não é processada — ela vira literalmente
 * `/prn-globo.png` no HTML final e, dentro do app empacotado (que serve os
 * arquivos por `file://`), isso resolve para `file:///prn-globo.png`, que
 * não existe. Mesmo problema documentado em `src/lib/backgrounds.ts:1-14`.
 */
export function PrnGlobo({ className }: { className?: string }) {
  return <img src={globo} alt="" className={cn('object-contain', className)} />
}
