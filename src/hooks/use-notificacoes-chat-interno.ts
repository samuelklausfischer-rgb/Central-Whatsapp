import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/use-auth'
import { getRawDevicePrefs } from '@/hooks/use-notification-prefs'
import { janelaEmPrimeiroPlano, mostrarNotificacao } from '@/lib/notificacao-do-sistema'
import { tocarSomDeNotificacao } from '@/lib/som-de-notificacao'
import { previewDaMensagem } from '@/lib/chat-interno'
import type { MensagemInterna } from '@/lib/supabase/chat-interno-types'
import {
  aoChegarMensagemNova,
  carregarMembros,
  nomeDaPessoa,
  obterEstadoDoChatInterno,
  type EventoDeMensagemNova,
} from '@/stores/chatInterno'

/**
 * A chave de preferência do Chat interno.
 *
 * Mesmo desenho de `PREF_AGENDA`: `useNotificationPrefs` é um `Record<string, ...>`
 * indexado por aparelho do WhatsApp, e o prefixo `app:` deixa claro que isto NÃO
 * é aparelho (os ids de device são UUID — não colidem). Ganha de graça a
 * persistência no perfil e o espelho local, sem tabela nem migration. Ausente =
 * tudo ligado, o padrão de `getRawDevicePrefs`.
 */
export const PREF_CHAT_INTERNO = 'app:chat-interno'

/** Quanto esperar o nome do autor de grupo antes de avisar sem ele. */
const ESPERA_DO_NOME_MS = 1500

export function enderecoDaConversaInterna(conversaId: string): string {
  return `/chat?interno=${encodeURIComponent(conversaId)}`
}

function textoDoAviso(m: MensagemInterna): string {
  const preview = previewDaMensagem(m)
  if (m.tipo === 'imagem') return `📷 ${preview}`
  if (m.tipo === 'audio') return '🎤 Áudio'
  if (m.tipo === 'arquivo') return `📎 ${preview}`
  return preview
}

/**
 * Som e notificação do sistema para mensagem nova do Chat interno.
 *
 * Não abre canal: ouve os eventos que `use-chat-interno` já emite a partir do
 * ÚNICO canal Realtime da tabela. MONTAR NO `Layout`, uma vez só.
 *
 * Quando NÃO avisa:
 *  - mensagem minha (de outro aparelho);
 *  - conversa silenciada;
 *  - a conversa está aberta na tela e a janela está à frente;
 *  - mensagem de sistema ("fulano saiu") — exceto a que MOSTRA uma conversa nova
 *    para mim, que é como "você foi adicionado ao grupo X" chega;
 *  - som e 2º plano ambos desligados em `PREF_CHAT_INTERNO`.
 *
 * O clique leva a `/chat?interno=<id>`. Com service worker, é o listener do
 * `use-notificacoes-de-mensagem` (que navega para qualquer caminho interno que
 * o worker avisar) que cuida da navegação — por isso não há outro aqui.
 *
 * @param ativo `false` para quem não pode usar o Whats: nada de som para algo que
 *   a pessoa não consegue abrir.
 */
export function useNotificacoesChatInterno(ativo = true) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const usuarioId = user?.id

  // O ouvinte é registrado uma vez; a rota muda a toda hora e não deve
  // re-registrá-lo (perderia eventos entre a saída e a volta).
  const naRotaDoChat = useRef(false)
  naRotaDoChat.current = location.pathname.startsWith('/chat')

  useEffect(() => {
    if (!ativo || !usuarioId) return

    const irPara = (url: string) => {
      if (!url.startsWith('/') || url.startsWith('//')) return
      navigate(url)
    }

    const avisar = async ({ mensagem, conversa, conversaNova }: EventoDeMensagemNova) => {
      if (!conversa) return
      if (mensagem.autor_id === usuarioId) return
      if (mensagem.tipo === 'sistema' && !conversaNova) return
      if (conversa.silenciada) return

      const prefs = getRawDevicePrefs(usuarioId, PREF_CHAT_INTERNO)
      if (!prefs.sound && !prefs.background) return

      // Olhando para a conversa agora: o balão aparecendo já é o aviso. O
      // `emFoco` só existe enquanto a janela dela está montada, e fora de `/chat`
      // o ChatHub desmonta — a checagem de rota é cinto e suspensório.
      const foco = obterEstadoDoChatInterno().emFoco
      if (foco?.id === conversa.id && naRotaDoChat.current && janelaEmPrimeiroPlano()) return

      let corpo = textoDoAviso(mensagem)
      if (mensagem.tipo === 'sistema') {
        corpo = mensagem.conteudo ?? 'Você foi adicionado a uma conversa'
      } else if (conversa.tipo === 'grupo') {
        let autor = nomeDaPessoa(mensagem.autor_id)
        if (!autor && mensagem.autor_id) {
          // Primeira mensagem dessa pessoa que vemos: busca os membros, mas sem
          // segurar o aviso — um nome que demora não vale uma notificação atrasada.
          await Promise.race([
            carregarMembros(conversa.id).catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, ESPERA_DO_NOME_MS)),
          ])
          autor = nomeDaPessoa(mensagem.autor_id)
        }
        if (autor) corpo = `${autor}: ${corpo}`
      }

      const somSaiu = prefs.sound ? tocarSomDeNotificacao() : false
      if (!prefs.background) return
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

      void mostrarNotificacao(
        conversa.nome,
        {
          body: corpo,
          icon: '/pwa-192.png',
          badge: '/favicon-96.png',
          // Áudio bloqueado pela política de autoplay ⇒ quem apita é o sistema.
          silent: !prefs.sound || somSaiu,
          // Um aviso por conversa: uma rajada atualiza o mesmo cartão.
          tag: `chat-interno-${conversa.id}`,
          renotify: true,
          requireInteraction: !janelaEmPrimeiroPlano(),
          url: enderecoDaConversaInterna(conversa.id),
        } as NotificationOptions & { url: string },
        irPara,
      )
    }

    return aoChegarMensagemNova((evento) => {
      void avisar(evento)
    })
  }, [ativo, usuarioId, navigate])
}

export default useNotificacoesChatInterno
