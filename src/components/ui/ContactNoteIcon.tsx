export function ContactNoteIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <circle cx="10" cy="13" r="2" />
      <path d="M6 20.5v-.5a4 4 0 0 1 8 0v.5" />
      <line x1="15" y1="12" x2="19" y2="12" />
      <line x1="15" y1="15" x2="17" y2="15" />
    </svg>
  )
}
