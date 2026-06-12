import type { Contact } from '@/lib/supabase/types'

/**
 * Check if a JID is a group
 */
export function isGroupJid(jid: string | undefined | null): boolean {
  if (!jid) return false
  return jid.includes('@g.us')
}

/**
 * Normalize any phone number input to digits only.
 * Handles formats like:
 * - @47988722513
 * - 47988722513
 * - +5547988722513
 * - 47988722513@s.whatsapp.net
 * - @lid
 * - @c.us
 */
export function normalizeToDigits(raw: string): string {
  if (!raw) return ''
  
  // Remove common WhatsApp suffixes
  let cleaned = raw
    .replace('@s.whatsapp.net', '')
    .replace('@lid', '')
    .replace('@c.us', '')
    .replace('@g.us', '')
    .replace(/^@/, '')
  
  // Extract only digits
  const digits = cleaned.replace(/\D/g, '')
  
  // Handle Brazilian numbers: ensure 55 prefix
  if (digits.length >= 10 && digits.length <= 13) {
    if (digits.startsWith('55')) {
      return digits
    }
    // Assume Brazilian number without country code
    return `55${digits}`
  }
  
  return digits
}

/**
 * Normalize a contact ID to a comparable form.
 * Returns null if the input is invalid.
 */
export function normalizeContactId(raw: string): { 
  type: 'group' | 'person' | 'unknown'
  normalizedId: string 
} | null {
  if (!raw || raw === 'Unknown Sender') return null
  
  // Check if it's a group
  if (isGroupJid(raw)) {
    return {
      type: 'group',
      normalizedId: raw.trim()
    }
  }
  
  // Check if it's a LID (WhatsApp business label)
  if (raw.includes('@lid')) {
    const digits = raw.replace('@lid', '').replace(/^@/, '').replace(/\D/g, '')
    if (digits) {
      return {
        type: 'person',
        normalizedId: normalizeToDigits(digits)
      }
    }
  }
  
  // Handle @c.us (older WhatsApp format)
  if (raw.includes('@c.us')) {
    const digits = raw.replace('@c.us', '').replace(/^@/, '').replace(/\D/g, '')
    if (digits) {
      return {
        type: 'person',
        normalizedId: normalizeToDigits(digits)
      }
    }
  }
  
  // Extract digits from the raw input
  const digits = raw.replace(/\D/g, '')
  
  if (digits.length >= 10) {
    return {
      type: 'person',
      normalizedId: normalizeToDigits(raw)
    }
  }
  
  return {
    type: 'unknown',
    normalizedId: raw.trim()
  }
}

/**
 * Generate all possible lookup keys for a contact.
 * This handles various formats that might appear in the database or incoming data.
 */
function generateContactKeys(remote_jid: string): string[] {
  if (!remote_jid || typeof remote_jid !== 'string') return []
  
  const keys: string[] = []
  
  // Original key
  keys.push(remote_jid)
  
  // If it's a group, also add the raw group JID
  if (isGroupJid(remote_jid)) {
    keys.push(remote_jid)
    return keys
  }
  
  // Generate digit-based keys
  const digits = remote_jid.replace(/\D/g, '')
  if (!digits) return keys
  
  // Full digits with 55
  if (digits.startsWith('55')) {
    keys.push(digits)
    
    // Without 55 prefix (for matching Brazilian numbers without country code)
    if (digits.length > 2) {
      keys.push(digits.slice(2))
    }
  } else {
    // Without 55 prefix
    keys.push(digits)
    
    // With 55 prefix
    keys.push(`55${digits}`)
  }
  
  // Also add common WhatsApp formats
  keys.push(`${remote_jid}@s.whatsapp.net`)
  keys.push(`${digits}@s.whatsapp.net`)
  
  // Remove duplicates
  return [...new Set(keys)]
}

/**
 * Build an in-memory index of contacts for O(1) lookups.
 * The index maps all possible normalized keys to the contact record.
 */
export function buildContactIndex(contacts: Contact[]): Map<string, Contact> {
  const index = new Map<string, Contact>()
  
  for (const contact of contacts) {
    const keys = generateContactKeys(contact.remote_jid)
    for (const key of keys) {
      // Only set if not already present (first contact wins)
      if (!index.has(key)) {
        index.set(key, contact)
      }
    }
  }
  
  return index
}

/**
 * Find a contact by any identifier format using the pre-built index.
 */
export function findContactByIdentifier(
  rawId: string,
  contactIndex: Map<string, Contact>
): Contact | undefined {
  if (!rawId || rawId === 'Unknown Sender') return undefined
  
  // Try direct lookup first
  if (contactIndex.has(rawId)) {
    return contactIndex.get(rawId)
  }
  
  // Try normalized lookup
  const normalized = normalizeContactId(rawId)
  if (!normalized) return undefined
  
  // For groups, match exactly
  if (normalized.type === 'group') {
    return contactIndex.get(normalized.normalizedId)
  }
  
  // For persons, try the normalized ID
  if (contactIndex.has(normalized.normalizedId)) {
    return contactIndex.get(normalized.normalizedId)
  }
  
  // Try variations
  const digits = normalized.normalizedId.replace(/\D/g, '')
  
  // Try with and without 55 prefix
  if (digits.startsWith('55')) {
    if (contactIndex.has(digits)) return contactIndex.get(digits)
    if (contactIndex.has(digits.slice(2))) return contactIndex.get(digits.slice(2))
  } else {
    if (contactIndex.has(digits)) return contactIndex.get(digits)
    if (contactIndex.has(`55${digits}`)) return contactIndex.get(`55${digits}`)
  }
  
  // Try with WhatsApp domain
  const withDomain = `${digits}@s.whatsapp.net`
  if (contactIndex.has(withDomain)) return contactIndex.get(withDomain)
  
  return undefined
}

/**
 * Resolve the display name for a contact with priority:
 * 1. nickname (manual user alias)
 * 2. name (saved contact name)
 * 3. sender_name (from message/conversation)
 * 4. formatted phone number (fallback)
 */
export function resolveContactDisplayName(
  rawId: string,
  contactIndex: Map<string, Contact>,
  options?: {
    sender_name?: string | null
    fallback?: string
  }
): string {
  // Handle groups
  if (isGroupJid(rawId)) {
    const contact = findContactByIdentifier(rawId, contactIndex)
    return contact?.nickname || contact?.name || 'Grupo'
  }
  
  // Handle unknown/invalid
  if (!rawId || rawId === 'Unknown Sender') {
    return options?.fallback || 'Unknown Sender'
  }
  
  // Try to find contact
  const contact = findContactByIdentifier(rawId, contactIndex)
  
  if (contact) {
    // Priority: nickname > name > sender_name > formatted number
    if (contact.nickname) return contact.nickname
    if (contact.name) return contact.name
  }
  
  // No contact found or contact has no name
  if (options?.sender_name) {
    return options.sender_name
  }
  
  // Format the phone number as fallback
  const normalizedDigits = normalizeToDigits(rawId)
  
  // Format: (XX) XXXXX-XXXX for Brazilian numbers
  if (normalizedDigits.length >= 12) {
    const ddd = normalizedDigits.slice(2, 4)
    const number = normalizedDigits.slice(4)
    
    if (number.length === 9) {
      return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`
    } else if (number.length === 8) {
      return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`
    }
  }
  
  // Fallback to raw ID or provided fallback
  return options?.fallback || rawId
}

/**
 * Format a phone number for display.
 * Handles various input formats and returns a human-readable string.
 */
export function formatPhoneNumber(raw: string): string {
  const digits = normalizeToDigits(raw)
  
  if (digits.length >= 12) {
    const country = digits.slice(0, 2)
    const ddd = digits.slice(2, 4)
    const number = digits.slice(4)
    
    if (number.length === 9) {
      return `+${country} (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`
    } else if (number.length === 8) {
      return `+${country} (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`
    }
  }
  
  // If can't format nicely, return digits with basic formatting
  if (digits.length >= 10) {
    return digits.replace(/(\d{2})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4')
  }
  
  return raw
}
