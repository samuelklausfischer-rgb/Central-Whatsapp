export function GridBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none -z-10 bg-[radial-gradient(ellipse_at_center,_hsl(var(--primary)_/_0.15)_0%,_hsl(var(--background))_100%)]">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(to right, hsl(var(--muted-foreground) / 0.15) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--muted-foreground) / 0.15) 1px, transparent 1px)`,
          backgroundSize: '20px 20px',
        }}
      />
    </div>
  )
}
