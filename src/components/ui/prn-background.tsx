/**
 * Fundo padrão do app: arte abstrata azul do PRN, feita só de CSS/SVG inline.
 *
 * A composição reproduz o globo do PRN "explodido" — o logo é uma esfera
 * montada de quadrados azuis arredondados, então aqui os quadrados voltam
 * soltos, espalhados pelos cantos, como se a esfera tivesse se desmontado
 * atrás do conteúdo.
 *
 * É SVG inline, não uma imagem, por dois motivos: (1) zero KB extra no
 * instalador do Electron — o app já carrega fotos de fundo pesadas para o
 * login (ver `src/lib/backgrounds.ts`); (2) uma imagem estática cairia na
 * mesma armadilha do `vite build --base ./` documentada naquele arquivo —
 * um caminho montado ou mal resolvido em runtime quebra silenciosamente
 * dentro do pacote `file://`. Path inline no JSX não tem esse risco.
 *
 * Todas as cores usam `hsl(var(--bg-*))` (definidas em `src/main.css`) para
 * que o tema `.dark` repinte a MESMA geometria, sem duplicar o SVG. As duas
 * únicas cores fixas são o acento rosa (`#f0abfc`), de propósito — a
 * referência visual do PRN usa esse ponto de cor fora da paleta azul.
 *
 * Sem animação: o app roda dentro do Electron e um fundo `fixed` já é caro
 * para o compositor sozinho; animar dezenas de formas por cima gastaria GPU
 * que a janela não tem de sobra.
 */
export function PrnBackground() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
      {/* a) Campo: gradiente vertical de base */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(to bottom, hsl(var(--bg-campo-de)), hsl(var(--bg-campo-para)))',
        }}
      />

      {/* b) Brilhos difusos, grandes e suaves — dão profundidade sem custar blur */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: [
            'radial-gradient(ellipse 900px 700px at 0% 100%, hsl(var(--bg-brilho) / 0.18) 0%, transparent 60%)',
            'radial-gradient(ellipse 900px 700px at 100% 100%, hsl(var(--bg-brilho) / 0.18) 0%, transparent 60%)',
            'radial-gradient(ellipse 800px 600px at 100% 0%, hsl(var(--bg-brilho) / 0.18) 0%, transparent 60%)',
          ].join(', '),
        }}
      />

      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="prn-fita-1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--bg-forma-1))" />
            <stop offset="100%" stopColor="hsl(var(--bg-forma-3))" />
          </linearGradient>
          <linearGradient id="prn-fita-2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--bg-forma-2))" />
            <stop offset="100%" stopColor="hsl(var(--bg-forma-1))" />
          </linearGradient>
          <linearGradient id="prn-fita-3" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--bg-forma-3))" />
            <stop offset="100%" stopColor="hsl(var(--bg-forma-2))" />
          </linearGradient>
          <radialGradient id="prn-faisca" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="0.9" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <pattern id="prn-halftone" width="18" height="18" patternUnits="userSpaceOnUse">
            <circle cx="4" cy="4" r="1.6" fill="hsl(var(--bg-traco))" />
          </pattern>
        </defs>

        {/* c) Fitas/ondas — elemento dominante, varrendo a base da tela */}
        <path
          d="M -100 780 C 250 680, 450 860, 780 760 C 1100 660, 1250 820, 1540 720 L 1540 940 L -100 940 Z"
          fill="url(#prn-fita-1)"
          opacity="0.22"
        />
        <path
          d="M -100 840 C 300 900, 520 720, 860 820 C 1150 900, 1300 760, 1540 830 L 1540 940 L -100 940 Z"
          fill="url(#prn-fita-2)"
          opacity="0.18"
        />
        <path
          d="M -100 700 C 220 620, 500 780, 820 680 C 1080 600, 1280 720, 1540 640 L 1540 940 L -100 940 Z"
          fill="url(#prn-fita-3)"
          opacity="0.12"
        />
        <path
          d="M -100 900 C 350 840, 600 940, 950 880 C 1200 840, 1350 900, 1540 860 L 1540 940 L -100 940 Z"
          fill="url(#prn-fita-1)"
          opacity="0.28"
        />

        {/* Anéis finos — só contorno, opacidade baixa */}
        <circle cx="1280" cy="140" r="160" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.25" />
        <circle cx="140" cy="420" r="120" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.2" />
        <circle cx="1360" cy="480" r="90" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.15" />

        {/* Malha de pontos (halftone) — canto superior-esquerdo */}
        <rect x="0" y="0" width="260" height="200" fill="url(#prn-halftone)" opacity="0.35" />

        {/* Quadrados arredondados — "esfera explodida" do logo PRN.
            Clusters no topo-esquerdo, topo-direito, base-esquerda e base-direita. */}
        {/* topo-esquerda */}
        <rect x="60" y="60" width="46" height="46" rx="10" fill="hsl(var(--bg-forma-1))" opacity="0.22" transform="rotate(12 83 83)" />
        <rect x="150" y="120" width="28" height="28" rx="7" fill="hsl(var(--bg-forma-2))" opacity="0.18" transform="rotate(-8 164 134)" />
        <rect x="40" y="180" width="20" height="20" rx="5" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.4" transform="rotate(20 50 190)" />
        <rect x="200" y="40" width="60" height="60" rx="12" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.3" transform="rotate(-15 230 70)" />

        {/* topo-direita */}
        <rect x="1180" y="220" width="70" height="70" rx="14" fill="hsl(var(--bg-forma-3))" opacity="0.16" transform="rotate(18 1215 255)" />
        <rect x="1310" y="90" width="34" height="34" rx="8" fill="hsl(var(--bg-forma-2))" opacity="0.25" transform="rotate(-10 1327 107)" />
        <rect x="1250" y="160" width="22" height="22" rx="5" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.35" transform="rotate(10 1261 171)" />
        <rect x="1370" y="240" width="140" height="140" rx="20" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.12" transform="rotate(8 1440 310)" />

        {/* base-esquerda */}
        <rect x="90" y="700" width="52" height="52" rx="12" fill="hsl(var(--bg-forma-1))" opacity="0.2" transform="rotate(-14 116 726)" />
        <rect x="180" y="770" width="30" height="30" rx="7" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.4" transform="rotate(22 195 785)" />
        <rect x="30" y="620" width="24" height="24" rx="6" fill="hsl(var(--bg-forma-2))" opacity="0.3" transform="rotate(16 42 632)" />

        {/* base-direita */}
        <rect x="1250" y="640" width="60" height="60" rx="14" fill="hsl(var(--bg-forma-3))" opacity="0.18" transform="rotate(-10 1280 670)" />
        <rect x="1340" y="720" width="36" height="36" rx="8" fill="none" stroke="hsl(var(--bg-traco))" strokeWidth="1" opacity="0.35" transform="rotate(14 1358 738)" />
        <rect x="1200" y="760" width="26" height="26" rx="6" fill="hsl(var(--bg-forma-1))" opacity="0.24" transform="rotate(-18 1213 773)" />

        {/* Pontos soltos — a maioria azul/ciano, 2 em rosa como acento */}
        <circle cx="320" cy="200" r="4" fill="hsl(var(--bg-forma-2))" opacity="0.5" />
        <circle cx="480" cy="120" r="6" fill="hsl(var(--bg-forma-1))" opacity="0.4" />
        <circle cx="700" cy="260" r="3" fill="hsl(var(--bg-forma-3))" opacity="0.45" />
        <circle cx="920" cy="150" r="5" fill="hsl(var(--bg-forma-2))" opacity="0.35" />
        <circle cx="1050" cy="380" r="4" fill="hsl(var(--bg-forma-1))" opacity="0.4" />
        <circle cx="600" cy="500" r="3" fill="hsl(var(--bg-forma-3))" opacity="0.3" />
        <circle cx="380" cy="560" r="5" fill="hsl(var(--bg-forma-2))" opacity="0.35" />
        <circle cx="850" cy="600" r="4" fill="hsl(var(--bg-forma-1))" opacity="0.3" />
        <circle cx="1150" cy="560" r="6" fill="hsl(var(--bg-forma-3))" opacity="0.3" />
        <circle cx="220" cy="380" r="3" fill="hsl(var(--bg-forma-2))" opacity="0.4" />
        <circle cx="520" cy="330" r="8" fill="#f0abfc" opacity="0.5" />
        <circle cx="980" cy="470" r="6" fill="#f0abfc" opacity="0.4" />

        {/* Brilhos — pontos brancos com halo, simulando faísca */}
        <circle cx="420" cy="240" r="40" fill="url(#prn-faisca)" opacity="0.6" />
        <circle cx="1080" cy="200" r="50" fill="url(#prn-faisca)" opacity="0.5" />
        <circle cx="760" cy="620" r="45" fill="url(#prn-faisca)" opacity="0.45" />
        <circle cx="180" cy="500" r="35" fill="url(#prn-faisca)" opacity="0.4" />
      </svg>
    </div>
  )
}
