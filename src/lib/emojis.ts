import twemoji from 'twemoji'

/** Os 50 emojis mais usados no WhatsApp, agrupados como no picker nativo dele. */
export const TOP_EMOJIS: string[] = [
  '😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😉', '😎', '🤩',
  '😢', '😭', '😅', '😆', '🙄', '😴', '😔', '😩', '😡', '🤔',
  '👍', '👎', '👏', '🙏', '💪', '🙌', '👌', '✌️', '🤝', '👋',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💕', '💔', '💯',
  '🔥', '✨', '🎉', '🎂', '🌹', '😱', '🥺', '😜', '🤗', '👀',
]

const TWEMOJI_CDN = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/'

/** URL da arte colorida (estilo Twitter/WhatsApp) pro emoji, em vez da fonte nativa do SO. */
export function getEmojiImageUrl(emoji: string): string {
  // Os assets do twemoji já são sempre "estilo emoji" — o seletor de variação
  // (U+FE0F) fica de fora do nome do arquivo, senão dá 404 (ex: ✌️, ❤️).
  const codepoint = twemoji.convert.toCodePoint(emoji).replace(/-fe0f$/, '')
  return `${TWEMOJI_CDN}${codepoint}.svg`
}
