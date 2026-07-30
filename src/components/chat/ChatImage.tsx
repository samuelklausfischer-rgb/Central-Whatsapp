import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Imagem do balão, com piso de altura até o arquivo chegar.
 *
 * `<img>` sem `width`/`height` e sem `aspect-ratio` ocupa ZERO pixel antes de
 * carregar, e salta para a altura natural depois. Como a conversa rola para o
 * fim antes de qualquer foto chegar, cada salto empurrava o histórico para
 * baixo e a conversa "escorregava" para o meio.
 *
 * O piso não elimina o ajuste — sem a dimensão real não há como acertar a
 * altura, e o banco só guarda `name`, `type`, `url` e `mime`. Ele troca um salto
 * de "0 → 300px" por "160 → 300px". Quem garante a POSIÇÃO é o `ResizeObserver`
 * do `ChatWindow`, que reancora no fim a cada mudança de altura; isto aqui é
 * conforto visual, para a conversa não sacudir enquanto as fotos aparecem.
 */
export function ChatImage({
  src,
  alt,
  className,
  reservaClassName = 'w-[240px] min-h-[160px]',
}: {
  src: string
  alt: string
  className?: string
  /**
   * Tamanho reservado ENQUANTO carrega — largura e altura. A largura importa
   * tanto quanto a altura: sem ela o balão nasceria com ~30px e daria um pulo
   * horizontal quando a foto chegasse. Figurinha usa um valor menor que foto.
   */
  reservaClassName?: string
}) {
  const [assentou, setAssentou] = useState(false)

  return (
    // Depois que a imagem assenta, a reserva SAI e a largura volta a ser a
    // natural (limitada pelo `max-w` do botão em volta). Manter a largura fixa
    // aqui esticava foto pequena — QR code de boleto, etiqueta de exame, print —
    // para 238px, borrada, num balão do dobro do tamanho necessário.
    <span className={cn('block', assentou ? 'w-full' : reservaClassName)}>
      <img
        src={src}
        alt={alt}
        onLoad={() => setAssentou(true)}
        // Imagem que falha também precisa parar de reservar espaço, senão o
        // balão fica com um vazio permanente do tamanho do piso.
        onError={() => setAssentou(true)}
        className={className}
      />
    </span>
  )
}
