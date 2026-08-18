import { useState, useEffect } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { User } from 'lucide-react'
import { fetchAvatar } from '@/services/contacts'
import { syncDeviceAvatar } from '@/services/devices'
import { PrnGlobo } from '@/components/ui/prn-globo'

// Aparelhos cujo resync de foto já foi disparado nesta sessão de página.
// Módulo, não `useState`/`useRef`: o MESMO aparelho aparece em mais de um
// lugar da tela ao mesmo tempo (linha do dashboard, cabeçalho do chat, etc.),
// cada lugar monta uma instância própria de SmartAvatar, e um ref só protege
// a instância em que vive — a segunda instância do mesmo aparelho não veria
// o ref da primeira e disparia o resync de novo. É o mesmo raciocínio do
// cache negativo de `fetchAvatar` (comentado abaixo, para contatos): a
// dedupe precisa sobreviver entre montagens/instâncias, então vive fora do
// React, no módulo.
const devicesResyncDisparados = new Set<string>()

export function SmartAvatar({
  jid,
  name,
  instanceKey,
  contactRecord,
  deviceRecord,
  isInstance = false,
  className,
  fallbackClassName,
}: any) {
  const [imgError, setImgError] = useState(false)
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null)

  const record = isInstance ? deviceRecord : contactRecord
  const remoteUrl = record?.avatar_url

  // Identidade do avatar. O componente é REUTILIZADO entre contatos (o cabeçalho
  // do ChatWindow, por exemplo, não remonta ao trocar de conversa), então sem
  // este reset o `localAvatarUrl` do contato anterior continua pintado sobre o
  // contato novo — é a "foto errada no contato errado".
  const identityKey = `${isInstance ? 'device' : 'contact'}:${instanceKey || ''}:${jid || ''}`
  const [prevIdentityKey, setPrevIdentityKey] = useState(identityKey)
  if (identityKey !== prevIdentityKey) {
    // Ajustar estado durante o render é o padrão documentado do React para
    // "estado derivado de prop que mudou". Não usar ref aqui: um render pode ser
    // iniciado e descartado, e a mutação do ref sobreviveria — o render que de
    // fato comita veria a chave já atualizada e pularia justamente este reset.
    setPrevIdentityKey(identityKey)
    setLocalAvatarUrl(null)
    setImgError(false)
  }

  // Enquanto o reset acima não comita, `localAvatarUrl` ainda é do contato
  // anterior — ignorá-lo neste render evita um frame com a foto errada.
  const avatarUrl = remoteUrl || (identityKey === prevIdentityKey ? localAvatarUrl : null)

  const isOld =
    !isInstance &&
    (!record?.avatar_updated_at ||
      new Date().getTime() - new Date(record.avatar_updated_at).getTime() > 24 * 60 * 60 * 1000)
  const missingUrl = !isInstance && !avatarUrl

  // Fetch avatar when missing or stale.
  // A deduplicação mora em `fetchAvatar` (cache negativo de sessão por
  // instância+jid), não em refs locais: refs só protegiam ESTA instância do
  // componente, e a mesma conversa aparece na lista e no cabeçalho. O gatilho
  // antigo `isGroup && !record?.nickname` foi removido — não tinha janela de
  // tempo nenhuma e a edge function nunca escreve `nickname`, então todo grupo
  // sem apelido refazia o fetch em toda montagem, para sempre.
  useEffect(() => {
    if (isInstance || !jid || !instanceKey || jid === 'Unknown Sender') return
    if (!missingUrl && !isOld) return

    let cancelado = false
    fetchAvatar(jid, instanceKey)
      .then((data) => {
        if (!cancelado && data?.avatar_url) setLocalAvatarUrl(data.avatar_url)
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [jid, instanceKey, missingUrl, isOld, isInstance])

  const handleImageError = () => {
    setImgError(true)

    // Caminho de APARELHO: a URL guardada em `devices.avatar_url` é da CDN
    // do WhatsApp (pps.whatsapp.net) e expira. Quando a imagem falha, pedimos
    // à edge function `device-avatar` para rebuscar na Evolution e regravar
    // a coluna — no máximo 1 vez por aparelho por sessão (ver o Set no topo
    // do módulo). Não tratamos a resposta: o `useRealtime('devices')` já
    // existente no dashboard propaga a `avatar_url` nova sozinho quando ela
    // chega. Erro é engolido de propósito, como o caminho de contato abaixo
    // já faz — uma falha de resync não deve virar erro visível na tela, só
    // significa que o fallback (globo) continua sendo mostrado.
    if (isInstance) {
      const deviceId = deviceRecord?.id
      if (deviceId && !devicesResyncDisparados.has(deviceId)) {
        devicesResyncDisparados.add(deviceId)
        syncDeviceAvatar(deviceId).catch(() => {})
      }
      return
    }

    if (!jid || !instanceKey || jid === 'Unknown Sender') return
    fetchAvatar(jid, instanceKey, { retry: true })
      .then((data) => {
        if (data?.avatar_url) setLocalAvatarUrl(data.avatar_url)
      })
      .catch(() => {})
  }

  // When a real remote URL arrives from props (e.g. via real-time sync),
  // clear local state so we use the persistent URL going forward
  useEffect(() => {
    if (remoteUrl) {
      setImgError(false)
      setLocalAvatarUrl(null)
    }
  }, [remoteUrl])

  const showInitials =
    name && name !== 'Unknown Sender'
      ? name.substring(0, 2).toUpperCase()
      : jid && jid !== 'Unknown Sender'
        ? jid.substring(0, 2).toUpperCase()
        : ''

  return (
    <Avatar className={className}>
      {avatarUrl && !imgError && (
        <AvatarImage
          src={avatarUrl}
          alt={name || jid}
          onError={handleImageError}
          className="object-cover"
        />
      )}
      <AvatarFallback className={fallbackClassName}>
        {isInstance ? (
          // Aparelho NUNCA mostra iniciais nem o ícone genérico de prédio:
          // "Financeiro PRN" viraria "FI", que não identifica nada — o globo
          // do PRN é o fallback fixo, foto real por cima quando ela existir
          // e carregar. Por isso este ramo ignora `showInitials` de propósito
          // (diferente do ramo de contato abaixo, que é o comportamento
          // original e não muda).
          <PrnGlobo className="h-full w-full p-1" />
        ) : (
          showInitials || <User className="h-5 w-5 opacity-50" />
        )}
      </AvatarFallback>
    </Avatar>
  )
}
