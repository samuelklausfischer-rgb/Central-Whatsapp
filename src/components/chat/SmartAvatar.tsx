import { useState, useEffect, useRef } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { User, Building2 } from 'lucide-react'
import { fetchAvatar } from '@/services/contacts'

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
  const isFetchingRef = useRef(false)
  const fetchedJidRef = useRef<string | null>(null)

  const record = isInstance ? deviceRecord : contactRecord
  const remoteUrl = record?.avatar_url
  const avatarUrl = remoteUrl || localAvatarUrl
  const isGroup = !isInstance && Boolean(jid?.includes('@g.us'))

  const isOld =
    !isInstance &&
    (!record?.avatar_updated_at ||
      new Date().getTime() - new Date(record.avatar_updated_at).getTime() > 24 * 60 * 60 * 1000)
  const missingUrl = !isInstance && !avatarUrl
  const shouldRefreshGroup = isGroup && !record?.nickname

  // Fetch avatar when missing or stale
  useEffect(() => {
    if (
      !isInstance &&
      jid &&
      instanceKey &&
      (missingUrl || isOld || shouldRefreshGroup) &&
      !isFetchingRef.current &&
      jid !== 'Unknown Sender' &&
      fetchedJidRef.current !== jid
    ) {
      isFetchingRef.current = true
      fetchedJidRef.current = jid
      fetchAvatar(jid, instanceKey)
        .then((data) => {
          if (data?.avatar_url) setLocalAvatarUrl(data.avatar_url)
        })
        .catch(() => {})
    }
  }, [jid, instanceKey, missingUrl, isOld, isInstance, shouldRefreshGroup])

  const handleImageError = () => {
    setImgError(true)
    if (
      !isInstance &&
      jid &&
      instanceKey &&
      !isFetchingRef.current &&
      jid !== 'Unknown Sender' &&
      fetchedJidRef.current !== jid
    ) {
      isFetchingRef.current = true
      fetchedJidRef.current = jid
      fetchAvatar(jid, instanceKey)
        .then((data) => {
          if (data?.avatar_url) setLocalAvatarUrl(data.avatar_url)
        })
        .catch(() => {})
    }
  }

  // When a real remote URL arrives from props (e.g. via real-time sync),
  // clear local state so we use the persistent URL going forward
  useEffect(() => {
    if (remoteUrl) {
      setImgError(false)
      setLocalAvatarUrl(null)
      if (!isGroup) fetchedJidRef.current = null
      isFetchingRef.current = false
    }
  }, [remoteUrl, isGroup])

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
        {showInitials ||
          (isInstance ? (
            <Building2 className="h-5 w-5 opacity-50" />
          ) : (
            <User className="h-5 w-5 opacity-50" />
          ))}
      </AvatarFallback>
    </Avatar>
  )
}
