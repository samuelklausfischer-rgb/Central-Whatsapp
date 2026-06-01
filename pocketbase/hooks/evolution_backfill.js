routerAdd('POST', '/backend/v1/webhooks/evolution/backfill', (e) => {
  const body = e.requestInfo().body || {}
  const instanceName = body.instance || ''
  const limit = Math.min(parseInt(body.limit) || 50, 500)

  if (!instanceName) {
    return e.json(400, { error: 'instance name is required' })
  }

  let device
  try {
    device = $app.findFirstRecordByData('devices', 'instance_key', instanceName)
  } catch (_) {
    return e.json(404, { error: 'device not found for instance: ' + instanceName })
  }

  const EVOLUTION_API_URL = $secrets.get('EVOLUTION_API_URL') || 'http://evolution-api:8080'
  const EVOLUTION_API_KEY = $secrets.get('EVOLUTION_API_KEY') || ''

  let imported = 0
  let skipped = 0
  let errors = 0
  let page = 1
  let hasMore = true

  while (hasMore && imported + skipped + errors < limit) {
    let response
    try {
      response = $http.send({
        url: `${EVOLUTION_API_URL}/chat/findMessages/${encodeURIComponent(instanceName)}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: EVOLUTION_API_KEY,
        },
        body: JSON.stringify({
          where: {},
          page,
          limit: 100,
        }),
        timeout: 30,
      })
    } catch (err) {
      $app.logger().error('Backfill: Evolution API error', 'error', err.message)
      break
    }

    if (response.statusCode !== 200) {
      break
    }

    const result = response.json
    const messages = result?.messages?.records || result?.records || []

    if (messages.length === 0) {
      hasMore = false
      break
    }

    const messagesCol = $app.findCollectionByNameOrId('messages')

    for (const msg of messages) {
      if (imported + skipped + errors >= limit) {
        hasMore = false
        break
      }

      const key = msg.key || {}
      const externalId = key.id || ''

      if (externalId) {
        try {
          const existing = $app.findFirstRecordByFilter(
            'messages',
            'external_id = {:ext} && device_id = {:dev}',
            { ext: externalId, dev: device.id },
          )
          if (existing) {
            skipped++
            continue
          }
        } catch (_) {}
      }

      const messageObj = msg.message || {}
      let content = messageObj.conversation || ''
      if (!content && messageObj.extendedTextMessage?.text) content = messageObj.extendedTextMessage.text
      if (!content && messageObj.imageMessage) content = messageObj.imageMessage.caption || '[Imagem]'
      if (!content && messageObj.videoMessage) content = messageObj.videoMessage.caption || '[Vídeo]'
      if (!content && messageObj.audioMessage) content = '[Áudio]'
      if (!content && messageObj.documentMessage) {
        const fileName = messageObj.documentMessage.fileName || 'Documento'
        content = messageObj.documentMessage.caption || `[Documento: ${fileName}]`
      }
      if (!content && messageObj.stickerMessage) content = '[Figurinha]'
      if (!content) content = '[Mensagem de mídia]'

      const isFromMe = key.fromMe === true
      const pushName = msg.pushName || ''

      const rawJid = key.remoteJidAlt || key.remoteJid || ''
      const isGroup = rawJid.includes('@g.us')

      let remoteSender
      if (isGroup) {
        remoteSender = rawJid
      } else {
        remoteSender = rawJid
          .replace(/@s\.whatsapp\.net/g, '')
          .replace(/@lid/g, '')
          .replace(/\D/g, '')
      }

      if (!remoteSender) {
        skipped++
        continue
      }

      try {
        const newMsg = new Record(messagesCol)
        newMsg.set('content', content)
        newMsg.set('device_id', device.id)
        newMsg.set('remote_sender', remoteSender)
        newMsg.set('sender_name', pushName)
        newMsg.set('direction', isFromMe ? 'outbound' : 'inbound')
        newMsg.set('is_read', true)
        newMsg.set('origin', 'webhook')
        if (externalId) {
          newMsg.set('external_id', externalId)
        }
        $app.save(newMsg)
        imported++
      } catch (err) {
        errors++
      }
    }

    page++
  }

  return e.json(200, {
    status: 'completed',
    instance: instanceName,
    imported,
    skipped,
    errors,
  })
}, $apis.requireAuth())
