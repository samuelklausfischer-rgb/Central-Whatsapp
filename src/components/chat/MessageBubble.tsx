import React from 'react'
import {
  MessageSquare,
  MoreVertical,
  Pencil,
  Trash2,
  Copy,
  Clock,
  AlertCircle,
  Play,
  Smile,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SmartAvatar } from '@/components/chat/SmartAvatar'
import { AudioMessage } from '@/components/chat/AudioMessage'
import { DocumentBubble } from '@/components/chat/DocumentBubble'
import { ContactShareBubble } from '@/components/chat/ContactShareBubble'
import { ListMessageBubble } from '@/components/chat/ListMessageBubble'
import { reactToMessage } from '@/services/messages'
import { isPdfFile, isExcelFile } from '@/lib/file-type'
import { findContactByIdentifier, resolveContactDisplayName } from '@/lib/contacts/normalize'
import { renderMessage, isTechnicalPlaceholder, getDateLabel } from '@/lib/chat-message-format'
import type { ViewerMedia } from '@/components/chat/MediaViewer'

export interface MessageRow {
  msg: any
  isMe: boolean
  messageAttachments: any[]
  timestamp: string
  shouldShowDateSeparator: boolean
  shouldShowSenderLabel: boolean
  shouldShowReceivedAvatar: boolean
  thisSender: string | null
}

interface MessageBubbleProps {
  row: MessageRow
  device: any
  user: any
  contactIndex: any
  onOpenConversationByJid?: (jid: string) => void
  sendListOptionAsText: (optionTitle: string, sourceMsg: any) => void
  setMediaView: (media: ViewerMedia | null) => void
  messageMenuOpenId: string | null
  setMessageMenuOpenId: (id: string | null) => void
  reactionPopoverMessageId: string | null
  setReactionPopoverMessageId: (id: string | null) => void
  setReplyingTo: (msg: any) => void
  setEditingMessageId: (id: string | null) => void
  setMsgText: (text: string) => void
  setDeleteConfirmMsg: (msg: any) => void
  toast: (opts: any) => void
}

// Extraído de ChatWindow.tsx (item C5/C6 do plano de otimização): antes, o
// corpo inteiro de cada bolha de mensagem era JSX inline dentro do .map() do
// ChatWindow, no MESMO componente que contém o estado de digitação (msgText).
// Qualquer tecla digitada recalculava a renderização de até 500 mensagens.
// Agora é um componente memoizado à parte: só re-renderiza quando os campos
// de 'row' realmente mudam para aquela mensagem específica.
function MessageBubbleImpl({
  row,
  device,
  user,
  contactIndex,
  onOpenConversationByJid,
  sendListOptionAsText,
  setMediaView,
  messageMenuOpenId,
  setMessageMenuOpenId,
  reactionPopoverMessageId,
  setReactionPopoverMessageId,
  setReplyingTo,
  setEditingMessageId,
  setMsgText,
  setDeleteConfirmMsg,
  toast,
}: MessageBubbleProps) {
  const { msg, isMe, messageAttachments, timestamp, shouldShowDateSeparator, shouldShowSenderLabel, shouldShowReceivedAvatar, thisSender } = row

  return (
            <React.Fragment key={msg.id}>
              {shouldShowDateSeparator && (
                <div className="sticky top-2 z-20 flex justify-center py-2">
                  <span className="rounded-full border border-chat-border bg-chat-panel/90 px-3 py-1 text-[12px] font-medium text-chat-muted shadow-chat backdrop-blur">
                    {getDateLabel(msg.created_at)}
                  </span>
                </div>
              )}
            <div
              className={`flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-300 ${isMe ? 'items-end' : 'items-start'}`}
            >
              {shouldShowSenderLabel && (
                <div
                  className="text-[12px] leading-none font-semibold mb-1 ml-1 px-1.5 py-0.5 rounded-full bg-chat-text/10 text-chat-text/80 border border-chat-text/10 inline-flex items-center gap-1.5 select-none"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-chat-text/30 flex-shrink-0" />
                  <span>{thisSender}</span>
                </div>
              )}
              <div
                className={`flex gap-2.5 items-end w-full ${isMe ? 'justify-end' : 'justify-start'}`}
              >
              {!isMe && (
                shouldShowReceivedAvatar ? (
                  <SmartAvatar
                    jid={msg.remote_sender}
                    name={resolveContactDisplayName(msg.remote_sender, contactIndex, {
                      sender_name: msg.sender_name
                    })}
                    instanceKey={device?.instance_key}
                    contactRecord={findContactByIdentifier(msg.remote_sender, contactIndex)}
                    className="h-7 w-7 border border-chat-border shadow-sm flex-shrink-0 mb-1 hidden sm:block"
                    fallbackClassName="bg-chat-panel text-chat-muted text-xs"
                  />
                  ) : (
                    <div className="h-7 w-7 flex-shrink-0 mb-1 hidden sm:block" />
                  )
                )}
                <div
                  className={`max-w-[88%] sm:max-w-[78%] rounded-2xl px-3.5 py-2 shadow-chat-bubble relative group transition-all duration-150 ${
                    isMe
                      ? 'bg-chat-bubble-out text-chat-text rounded-br-sm border border-chat-bubble-outline'
                      : 'bg-chat-bubble-in text-chat-text rounded-bl-sm'
                  }`}
                >
                  {!msg.deleted_at && msg.reply_to_snapshot && (
                    <div className="flex items-start gap-2 mb-2 pl-2 border-l-2 border-chat-text/20">
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-chat-muted/90">
                          {msg.reply_to_snapshot.sender_name || 'Mensagem original'}
                        </div>
                          <div className="text-[12px] truncate text-chat-muted/70">
                            {isTechnicalPlaceholder(msg.reply_to_snapshot.content) ? 'Voz' : msg.reply_to_snapshot.content || ''}
                          </div>
                      </div>
                    </div>
                  )}
                    {messageAttachments.length > 0 && (
                     <div className="flex flex-col gap-2 mb-2">
                       {messageAttachments.map((att: any, idx: number) => {
                          if (att && typeof att === 'object' && att.type === 'contact') {
                            return (
                              <ContactShareBubble
                                key={idx}
                                name={att.name || 'Contato'}
                                phone={att.phone || null}
                                onOpenConversation={(jid) => onOpenConversationByJid?.(jid)}
                              />
                            )
                          }
                          if (att && typeof att === 'object' && att.type === 'list') {
                            return (
                              <ListMessageBubble
                                key={idx}
                                title={att.title || ''}
                                description={att.description || ''}
                                buttonText={att.buttonText || 'Ver opções'}
                                sections={Array.isArray(att.sections) ? att.sections : []}
                                onSelectOption={(optionTitle) => sendListOptionAsText(optionTitle, msg)}
                              />
                            )
                          }
                          if (att && typeof att === 'object' && att.url) {
                            if (att.type === 'audio') {
                             return (
                               <div key={idx}>
                                 <AudioMessage src={att.url} isMe={isMe} msgId={msg.id} />
                               </div>
                              )
                            }
                          if (att.type === 'video') {
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setMediaView({ url: att.url, type: 'video', name: att.name })}
                                className="group relative block max-w-[300px] overflow-hidden rounded-xl border border-chat-border bg-black shadow-sm"
                              >
                                <video
                                  src={att.url}
                                  muted
                                  preload="metadata"
                                  className="w-full max-h-[320px] object-contain pointer-events-none"
                                />
                                <span className="absolute inset-0 flex items-center justify-center">
                                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white transition-colors group-hover:bg-black/70">
                                    <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
                                  </span>
                                </span>
                              </button>
                            )
                          }
                           if (att.type === 'image') {
                             return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setMediaView({ url: att.url, type: 'image', name: att.name })}
                                className="block max-w-[240px] overflow-hidden rounded-xl border border-chat-border hover:opacity-90 hover:scale-[1.02] transition-all duration-300 shadow-sm cursor-zoom-in"
                              >
                                <img
                                  src={att.url}
                                  alt={att.name || 'Imagem'}
                                  className="w-full h-auto object-cover pointer-events-none"
                                />
                              </button>
                             )
                           }
                          if (att.type === 'sticker') {
                            return (
                              <a
                                key={idx}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block max-w-[160px] overflow-hidden rounded-xl hover:opacity-90 hover:scale-[1.02] transition-all duration-300"
                              >
                                <img
                                  src={att.url}
                                  alt={att.name || 'Figurinha'}
                                  className="w-full h-auto object-contain"
                                />
                              </a>
                            )
                          }
                          {
                            const docName = att.name || att.url
                            const hasPreview = isPdfFile(docName) || isExcelFile(docName)
                            return (
                              <DocumentBubble
                                key={idx}
                                url={att.url}
                                name={docName}
                                onOpenPreview={
                                  hasPreview
                                    ? () => setMediaView({ url: att.url, type: isPdfFile(docName) ? 'pdf' : 'excel', name: att.name })
                                    : null
                                }
                              />
                            )
                          }
                        }
                        const filename = att as string
                        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/chat-attachments/${msg.id}/${filename}`
                        const isImage = /\.(jpeg|jpg|gif|png|webp)$/i.test(filename)
                        const isVideo = /\.(mp4|webm|mov|m4v|3gp)$/i.test(filename)
                        const isAudio = /\.(mp3|ogg|oga|m4a|aac|wav|webm)$/i.test(filename)
                        const isSticker = /\.(webp)$/i.test(filename)
                        if (isAudio) {
                          return (
                            <div key={idx}>
                              <AudioMessage src={url} isMe={isMe} msgId={msg.id} />
                            </div>
                          )
                        }
                        if (isVideo) {
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setMediaView({ url, type: 'video', name: filename })}
                              className="group relative block max-w-[300px] overflow-hidden rounded-xl border border-chat-border bg-black shadow-sm"
                            >
                              <video
                                src={url}
                                muted
                                preload="metadata"
                                className="w-full max-h-[320px] object-contain pointer-events-none"
                              />
                              <span className="absolute inset-0 flex items-center justify-center">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white transition-colors group-hover:bg-black/70">
                                  <Play className="h-6 w-6 translate-x-0.5" fill="currentColor" />
                                </span>
                              </span>
                            </button>
                          )
                        }
                        if (isImage) {
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setMediaView({ url, type: 'image', name: filename })}
                              className="block max-w-[240px] overflow-hidden rounded-xl border border-chat-border hover:opacity-90 hover:scale-[1.02] transition-all duration-300 shadow-sm cursor-zoom-in"
                            >
                              <img
                                src={url}
                                alt={filename}
                                className="w-full h-auto object-cover pointer-events-none"
                              />
                            </button>
                          )
                        }
                        if (isSticker) {
                          return (
                            <a
                              key={idx}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block max-w-[160px] overflow-hidden rounded-xl hover:opacity-90 hover:scale-[1.02] transition-all duration-300"
                            >
                              <img
                                src={url}
                                alt={filename}
                                className="w-full h-auto object-contain"
                              />
                            </a>
                          )
                        }
                        {
                          const hasPreview = isPdfFile(filename) || isExcelFile(filename)
                          return (
                            <DocumentBubble
                              key={idx}
                              url={url}
                              name={filename}
                              onOpenPreview={
                                hasPreview
                                  ? () => setMediaView({ url, type: isPdfFile(filename) ? 'pdf' : 'excel', name: filename })
                                  : null
                              }
                            />
                          )
                        }
                      })}
                    </div>
                  )}
                    {msg.deleted_at ? (
                     <div className="text-[13px] italic text-chat-muted/60">
                       [Mensagem apagada]
                     </div>
                   ) : msg.content?.trim() && !isTechnicalPlaceholder(msg.content) ? (
                     <div className="text-[15px] leading-relaxed break-words">
                        {renderMessage(msg.content, isMe, onOpenConversationByJid)}
                       <span
  className={`inline-flex translate-y-[30%] items-center gap-1 whitespace-nowrap ${
    isMe ? 'float-right ml-3' : 'ml-1'
  }`}>
                         {msg.edited_at && (
                           <span className="text-[10px] text-chat-muted/60">(editado)</span>
                         )}
                         {msg.revoked_at && (
                           <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-400">
                             <Trash2 className="h-3 w-3" /> apagada
                           </span>
                         )}
                         {isMe && msg.status === 'sending' && (
                           <Clock className="h-3 w-3 text-chat-muted/60 shrink-0" />
                         )}
                         {isMe && msg.status === 'failed' && (
                           <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-400">
                             <AlertCircle className="h-3 w-3" /> falhou
                           </span>
                         )}
                         <span className="text-[10px] font-medium text-chat-muted/70">{timestamp}</span>
                         <DropdownMenu
                           open={messageMenuOpenId === msg.id}
                           onOpenChange={(open) => setMessageMenuOpenId(open ? msg.id : null)}
                         >
                           <DropdownMenuTrigger asChild>
                             <button
                               type="button"
                               onClick={(e) => e.stopPropagation()}
                               onMouseDown={(e) => e.stopPropagation()}
                               onPointerDown={(e) => e.stopPropagation()}
                               className={`text-chat-muted/50 hover:text-chat-muted transition-all duration-150 p-0.5 rounded hover:bg-chat-hover ${
                                 messageMenuOpenId === msg.id
                                   ? 'opacity-100 pointer-events-auto'
                                   : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                               }`}
                             >
                               <MoreVertical className="h-3.5 w-3.5" />
                             </button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" className="bg-chat-panel border-chat-border shadow-chat min-w-[170px]">
                             <DropdownMenuItem
                               className="cursor-pointer focus:bg-chat-hover"
                               onClick={(e) => {
                                 e.stopPropagation()
                                 setReplyingTo(msg)
                               }}
                             >
                               <MessageSquare className="h-4 w-4 mr-2" />
                               Responder
                             </DropdownMenuItem>
                             <DropdownMenuItem
                               className="cursor-pointer focus:bg-chat-hover"
                               onClick={async (e) => {
                                 e.stopPropagation()
                                 try {
                                   await navigator.clipboard.writeText(msg.content || '')
                                   toast({ title: 'Mensagem copiada!' })
                                 } catch {
                                   toast({ title: 'Erro ao copiar', variant: 'destructive' })
                                 }
                               }}
                             >
                               <Copy className="h-4 w-4 mr-2" />
                               Copiar
                             </DropdownMenuItem>
                             {isMe && !msg.deleted_at && (
                               <DropdownMenuItem
                                 className="cursor-pointer focus:bg-chat-hover"
                                 onClick={(e) => {
                                   e.stopPropagation()
                                   setEditingMessageId(msg.id)
                                   setMsgText(msg.content)
                                   setReplyingTo(null)
                                 }}
                               >
                                 <Pencil className="h-4 w-4 mr-2" />
                                 Editar
                               </DropdownMenuItem>
                             )}
                             <DropdownMenuSeparator className="bg-chat-border" />
                             {isMe && (
                               <DropdownMenuItem
                                 className="cursor-pointer focus:bg-chat-hover text-red-400"
                                 onClick={(e) => {
                                   e.stopPropagation()
                                   setDeleteConfirmMsg(msg)
                                 }}
                               >
                                 <Trash2 className="h-4 w-4 mr-2" />
                                 Apagar
                               </DropdownMenuItem>
                             )}
                           </DropdownMenuContent>
                         </DropdownMenu>
                       </span>
                     </div>
                    ) : null}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {Array.from(
                          msg.reactions.reduce((acc: Map<string, number>, r: any) => {
                            acc.set(r.emoji, (acc.get(r.emoji) || 0) + 1)
                            return acc
                          }, new Map())
                        ).map(([emoji, count]) => (
                          <span
                             key={emoji}
                              className="text-[11px] px-1 py-0.5 rounded-full border border-chat-text/10 bg-chat-text/5"
                          >
                            {emoji}{count > 1 ? String(count) : ''}
                          </span>
                        ))}
                      </div>
                    )}
                    {(msg.deleted_at || !msg.content?.trim() || isTechnicalPlaceholder(msg.content)) && (
                      <div className="mt-1.5 flex items-center justify-end gap-1">
                        {msg.edited_at && (
                          <span className="text-[10px] text-chat-muted/60">(editado)</span>
                        )}
                        <span className="text-[10px] font-medium text-chat-muted/70 translate-y-[1px]">
                          {timestamp}
                        </span>
                        {!msg.deleted_at && (
                          <DropdownMenu
                            open={messageMenuOpenId === msg.id}
                            onOpenChange={(open) => setMessageMenuOpenId(open ? msg.id : null)}
                          >
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                                className={`text-chat-muted/50 hover:text-chat-muted transition-all duration-150 p-0.5 rounded hover:bg-chat-hover ${
                                  messageMenuOpenId === msg.id
                                    ? 'opacity-100 pointer-events-auto'
                                    : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
                                }`}
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-chat-panel border-chat-border shadow-chat min-w-[170px]">
                              <DropdownMenuItem
                                className="cursor-pointer focus:bg-chat-hover"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setReplyingTo(msg)
                                }}
                              >
                                <MessageSquare className="h-4 w-4 mr-2" />
                                Responder
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="cursor-pointer focus:bg-chat-hover"
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  try {
                                    await navigator.clipboard.writeText(msg.content || '')
                                    toast({ title: 'Mensagem copiada!' })
                                  } catch {
                                    toast({ title: 'Erro ao copiar', variant: 'destructive' })
                                  }
                                }}
                              >
                                <Copy className="h-4 w-4 mr-2" />
                                Copiar
                              </DropdownMenuItem>
                              {isMe && !msg.deleted_at && (
                                <DropdownMenuItem
                                  className="cursor-pointer focus:bg-chat-hover"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingMessageId(msg.id)
                                    setMsgText(msg.content)
                                    setReplyingTo(null)
                                  }}
                                >
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Editar
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator className="bg-chat-border" />
                              {isMe && (
                                <DropdownMenuItem
                                  className="cursor-pointer focus:bg-chat-hover text-red-400"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setDeleteConfirmMsg(msg)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Apagar
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    )}
                     {!msg.deleted_at && (
                       <Popover
                         open={reactionPopoverMessageId === msg.id}
                         onOpenChange={(open) => setReactionPopoverMessageId(open ? msg.id : null)}
                       >
                         <PopoverTrigger asChild>
                           <button
                             type="button"
                             aria-label="Adicionar reação"
                             title="Adicionar reação"
                             onClick={(e) => e.stopPropagation()}
                             onMouseDown={(e) => e.stopPropagation()}
                             onPointerDown={(e) => e.stopPropagation()}
                             className={`absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-chat-border bg-chat-panel text-chat-muted shadow-chat transition-all duration-150 hover:bg-chat-hover hover:text-chat-text ${isMe ? '-left-8' : '-right-8'} ${
                               reactionPopoverMessageId === msg.id
                                 ? 'opacity-100 pointer-events-auto scale-100'
                                 : 'opacity-0 pointer-events-none scale-95 group-hover:opacity-100 group-hover:pointer-events-auto group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:scale-100'
                             }`}
                           >
                             <Smile className="h-4 w-4" />
                           </button>
                         </PopoverTrigger>
                         <PopoverContent
                           className="z-[80] w-auto rounded-full border-chat-border bg-chat-panel p-1.5 shadow-chat"
                           side="top"
                           align={isMe ? 'end' : 'start'}
                           sideOffset={6}
                           onClick={(e) => e.stopPropagation()}
                           onMouseDown={(e) => e.stopPropagation()}
                         >
                           <div className="flex gap-1">
                             {['👍', '❤️', '😂', '😮', '😢', '🙏'].map((emoji) => (
                               <button
                                 key={emoji}
                                 type="button"
                                 className="rounded-full p-1 text-lg transition-transform hover:scale-125 hover:bg-chat-hover"
                                 onClick={async (e) => {
                                   e.preventDefault()
                                   e.stopPropagation()
                                   try {
                                     await reactToMessage(msg.id, emoji, device.id, user.id)
                                     setReactionPopoverMessageId(null)
                                   } catch (err: any) {
                                     toast({ title: err.message || 'Erro ao reagir', variant: 'destructive' })
                                   }
                                 }}
                               >
                                 {emoji}
                               </button>
                             ))}
                           </div>
                         </PopoverContent>
                       </Popover>
                     )}
                 </div>
                {isMe && (
                  <div className="w-7 flex-shrink-0 hidden sm:block" />
                )}
              </div>
            </div>
          </React.Fragment>

  )
}

export const MessageBubble = React.memo(MessageBubbleImpl, (prev, next) => {
  return (
    prev.row === next.row &&
    prev.device === next.device &&
    prev.user === next.user &&
    prev.contactIndex === next.contactIndex &&
    prev.onOpenConversationByJid === next.onOpenConversationByJid &&
    prev.sendListOptionAsText === next.sendListOptionAsText &&
    prev.setMediaView === next.setMediaView &&
    prev.messageMenuOpenId === next.messageMenuOpenId &&
    prev.reactionPopoverMessageId === next.reactionPopoverMessageId &&
    prev.toast === next.toast
  )
})
