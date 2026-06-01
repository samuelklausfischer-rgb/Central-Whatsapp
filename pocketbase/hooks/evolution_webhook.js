function extractContent(msgObj) {
  if (!msgObj) return ''

  if (msgObj.conversation) return msgObj.conversation
  if (msgObj.extendedTextMessage?.text) return msgObj.extendedTextMessage.text

  if (msgObj.imageMessage) return msgObj.imageMessage.caption || '[Imagem]'
  if (msgObj.videoMessage) return msgObj.videoMessage.caption || '[Vídeo]'
  if (msgObj.audioMessage) return msgObj.audioMessage.ptt ? '[Áudio]' : '[Música]'
  if (msgObj.documentMessage) {
    const name = msgObj.documentMessage.fileName || 'Documento'
    return msgObj.documentMessage.caption || `[Documento: ${name}]`
  }
  if (msgObj.stickerMessage) return '[Figurinha]'
  if (msgObj.reactionMessage) return '[Reação]'
  if (msgObj.contactMessage) return '[Contato]'
  if (msgObj.locationMessage) return '[Localização]'
  if (msgObj.liveLocationMessage) return '[Localização ao vivo]'
  if (msgObj.listMessage) return '[Lista]'
  if (msgObj.buttonsMessage) return '[Botões]'
  if (msgObj.orderMessage) return '[Pedido]'
  if (msgObj.productMessage) return '[Produto]'

  return '[Mensagem de mídia]'
}

function extractRemoteIdentity(key) {
  const isGroup = key.remoteJid && key.remoteJid.endsWith('@g.us')

  if (isGroup) {
    return {
      remoteJid: key.remoteJid,
      isGroup: true,
      participantAlt: (key.participantAlt || key.participant || '')
        .replace(/@s\.whatsapp\.net/g, '')
        .replace(/@lid/g, '')
        .replace(/\D/g, ''),
    }
  }

  const rawJid = key.remoteJidAlt || key.remoteJid || ''
  const normalized = rawJid
    .replace(/@s\.whatsapp\.net/g, '')
    .replace(/@lid/g, '')
    .replace(/\D/g, '')

  return {
    remoteJid: normalized,
    isGroup: false,
    participantAlt: '',
  }
}

function processMessageWebhook(e, body) {
  const logger = $app.logger()

  const logContext = {
    event: body.event || 'unknown',
    instance: body.instance || 'unknown',
    status: 'unknown',
    reason: '',
  }

  const writeLog = (level, msg) => {
    logger[level](msg, 'event', logContext.event, 'instance', logContext.instance, 'status', logContext.status, 'reason', logContext.reason)
  }

  if (!body.instance || !body.data) {
    logContext.status = 'discarded'
    logContext.reason = 'missing instance or data'
    writeLog('warn', 'Webhook discarded')
    return e.json(200, { status: 'ignored', reason: 'missing instance or data' })
  }

  let messageData = body.data
  if (Array.isArray(messageData)) {
    messageData = messageData[0]
  }

  if (!messageData) {
    logContext.status = 'discarded'
    logContext.reason = 'empty data'
    writeLog('warn', 'Webhook discarded')
    return e.json(200, { status: 'ignored', reason: 'empty data' })
  }

  let device
  try {
    device = $app.findFirstRecordByData('devices', 'instance_key', body.instance)
  } catch (_) {
    logContext.status = 'discarded'
    logContext.reason = 'device not found for instance_key'
    writeLog('warn', 'Webhook discarded')
    return e.json(200, { status: 'error', message: 'device not found for instance: ' + body.instance })
  }

  const key = messageData.key || {}
  const isFromMe = key.fromMe === true
  const pushName = messageData.pushName || ''
  const externalId = key.id || ''

  const identity = extractRemoteIdentity(key)
  const remoteSender = identity.remoteJid

  if (!remoteSender) {
    logContext.status = 'discarded'
    logContext.reason = 'no remote sender identified'
    writeLog('warn', 'Webhook discarded')
    return e.json(200, { status: 'ignored', reason: 'no remote sender identified' })
  }

  const msgObj = messageData.message || {}
  const content = extractContent(msgObj)

  const nameToUse = pushName || (isFromMe ? device.getString('name') || '' : '')

  try {
    let contactRecord
    try {
      if (identity.isGroup) {
        contactRecord = $app.findFirstRecordByData('contacts', 'remote_jid', remoteSender)
      } else {
        contactRecord = $app.findFirstRecordByData('contacts', 'remote_jid', remoteSender)
      }
    } catch (_) {
      contactRecord = null
    }

    if (contactRecord) {
      let changed = false
      if (nameToUse && !contactRecord.get('name')) {
        contactRecord.set('name', nameToUse)
        changed = true
      }
      if (messageData.profilePicUrl && messageData.profilePicUrl !== contactRecord.getString('avatar_url')) {
        contactRecord.set('avatar_url', messageData.profilePicUrl)
        contactRecord.set('avatar_updated_at', new Date().toISOString())
        changed = true
      }
      if (changed) {
        $app.save(contactRecord)
      }
    } else {
      const contactsCol = $app.findCollectionByNameOrId('contacts')
      const newContact = new Record(contactsCol)
      newContact.set('remote_jid', remoteSender)
      newContact.set('name', nameToUse || '')
      if (messageData.profilePicUrl) {
        newContact.set('avatar_url', messageData.profilePicUrl)
        newContact.set('avatar_updated_at', new Date().toISOString())
      }
      $app.save(newContact)
    }
  } catch (contactErr) {
    writeLog('error', 'Failed to update contact: ' + contactErr.message)
  }

  try {
    let existingMsg = null
    if (externalId) {
      try {
        existingMsg = $app.findFirstRecordByFilter(
          'messages',
          'external_id = {:ext} && device_id = {:dev}',
          { ext: externalId, dev: device.id },
        )
      } catch (_) {
        existingMsg = null
      }
    }

    const messagesCol = $app.findCollectionByNameOrId('messages')

    if (existingMsg) {
      if (existingMsg.getString('content') !== content) {
        existingMsg.set('content', content)
      }
      existingMsg.set('sender_name', nameToUse || existingMsg.get('sender_name'))
      existingMsg.set('origin', 'webhook')
      $app.save(existingMsg)
    } else {
      const newMsg = new Record(messagesCol)
      newMsg.set('content', content)
      newMsg.set('device_id', device.id)
      newMsg.set('remote_sender', remoteSender)
      newMsg.set('sender_name', nameToUse)
      newMsg.set('direction', isFromMe ? 'outbound' : 'inbound')
      newMsg.set('is_read', isFromMe ? true : false)
      newMsg.set('origin', 'webhook')
      if (externalId) {
        newMsg.set('external_id', externalId)
      }
      $app.save(newMsg)

      if (!isFromMe) {
        device.set('unread_count', (device.getInt('unread_count') || 0) + 1)
        $app.save(device)
      }
    }
  } catch (err) {
    logContext.status = 'error'
    logContext.reason = err.message
    writeLog('error', 'Failed to save message: ' + err.message)
    return e.json(200, { status: 'error', message: err.message })
  }

  logContext.status = 'processed'
  logContext.reason = 'success'
  writeLog('info', 'Webhook processed successfully')

  return e.json(200, { status: 'success' })
}

function webhookHandler(e) {
  const body = e.requestInfo().body || {}
  const event = body.event || ''

  if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT') {
    return processMessageWebhook(e, body)
  }

  return e.json(200, { status: 'ignored', reason: 'unhandled event: ' + event })
}

routerAdd('POST', '/backend/v1/webhooks/evolution', webhookHandler)
routerAdd('POST', '/backend/v1/webhooks/evolution/MESSAGES_UPSERT', webhookHandler)
