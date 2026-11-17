// ─── GarageScene — the one-layer interactive landing illustration ────────────
// A 1600×900 SVG garage drawn entirely in code (no image assets), split into
// four stacked layers that move at different depths with the pointer
// (parallax via --mx/--my on .gs-root). Every interactive object is a <Hot>
// hotspot: hover/focus/tap calls bind(id) handlers from LandingScene, which
// opens the matching popover anchored to the hotspot's on-screen box.
//
// Layers (back → front): sky & street (seen through the windows) · wall ·
// floor & cars · front desk. CSS animations live in scene.css. Elements with
// a CSS animation never carry an SVG transform attribute themselves (CSS
// would override it) — they sit inside a positioned <g>.

const VB = "0 0 1600 900";
const RED = "#e3262d";
const INK = "#2b2422";

function Layer({ depth, children, className = "", style }) {
  return (
    <svg viewBox={VB} preserveAspectRatio="xMidYMid meet" className={`gs-layer ${className}`} style={{ "--depth": depth, ...style }} aria-hidden={false}>
      {children}
    </svg>
  );
}

function Tag({ x, y, label }) {
  const w = Math.max(56, label.length * 8.4 + 34);
  return (
    <g transform={`translate(${x - w / 2},${y - 30})`} style={{ pointerEvents: "none" }}>
      <g className="gs-tag">
        <rect width={w} height={26} rx={13} fill="#fff" stroke={RED} strokeWidth={2} />
        <circle cx={15} cy={13} r={5} fill={RED} />
        <circle cx={15} cy={13} r={5} fill={RED} className="gs-pulse" />
        <text x={27} y={18} fontSize={14} fontWeight={800} fill={INK} fontFamily="Inter, sans-serif">{label}</text>
      </g>
    </g>
  );
}

function Hot({ id, label, tag, bind, active, children, className = "" }) {
  return (
    <g className={`gs-hot ${active === id ? "is-active" : ""} ${className}`} data-hotspot={id} tabIndex={0} role="button" aria-label={label} {...bind(id)}>
      {children}
      {tag && <Tag x={tag[0]} y={tag[1]} label={label} />}
    </g>
  );
}

// ─── Vehicles (side view, front on the left) ────────────────────────────────
const SHAPES = {
  mpv: {
    w: 340, h: 148,
    body: "M10 115 Q8 90 30 82 L85 74 Q120 30 150 26 L285 24 Q310 24 322 50 L332 80 Q340 88 338 112 Q336 122 325 122 L300 122 A32 32 0 0 0 236 122 L110 122 A32 32 0 0 0 46 122 L20 122 Q10 122 10 115 Z",
    win: ["M98 74 Q125 38 152 34 L200 34 L200 74 Z", "M208 34 L280 33 Q298 33 308 52 L314 74 L208 74 Z"],
    wheels: [[78, 122, 26], [268, 122, 26]], light: [12, 88], tail: [328, 84], doors: [150, 206], mirror: [90, 70],
  },
  suv: {
    w: 350, h: 154,
    body: "M8 118 Q6 92 26 86 L92 80 L120 36 Q126 26 140 26 L300 26 Q318 26 326 44 L338 84 Q346 92 344 116 Q342 126 330 126 L306 126 A34 34 0 0 0 238 126 L112 126 A34 34 0 0 0 44 126 L18 126 Q8 126 8 118 Z",
    win: ["M104 80 L130 38 L200 38 L200 80 Z", "M208 38 L298 38 Q310 38 316 52 L326 80 L208 80 Z"],
    wheels: [[78, 126, 28], [272, 126, 28]], light: [10, 92], tail: [334, 88], doors: [150, 206], mirror: [98, 76], rails: true,
  },
  city: {
    w: 250, h: 128,
    body: "M8 100 Q6 80 24 74 L60 70 Q88 26 120 22 L180 22 Q205 22 218 48 L232 74 Q242 80 240 98 Q238 106 228 106 L210 106 A26 26 0 0 0 158 106 L92 106 A26 26 0 0 0 40 106 L16 106 Q8 106 8 100 Z",
    win: ["M70 70 Q92 34 120 30 L140 30 L140 70 Z", "M148 30 L178 30 Q196 30 206 50 L214 70 L148 70 Z"],
    wheels: [[66, 106, 22], [184, 106, 22]], light: [10, 80], tail: [234, 78], doors: [144], mirror: [64, 66],
  },
};

function Car({ kind, color, x, ground, night, stroke = "none", decal = true }) {
  const s = SHAPES[kind];
  const top = ground - s.h;
  return (
    <g transform={`translate(${x},${top})`}>
      <ellipse className="gs-shadow" cx={s.w / 2} cy={s.h - 2} rx={s.w * 0.52} ry={10} fill="#000" opacity={0.18} />
      <g className="gs-lift">
        {/* headlight beam (hover / night) */}
        <path className={`gs-headlight ${night ? "gs-headlight-on" : ""}`} d={`M${s.light[0] + 4} ${s.light[1]} L${s.light[0] - 150} ${s.light[1] - 30} L${s.light[0] - 150} ${s.light[1] + 40} Z`} fill="url(#gsBeam)" />
        {s.rails && <rect x={140} y={18} width={160} height={6} rx={3} fill="#8a8f96" />}
        <path d={s.body} fill={color} stroke={stroke} strokeWidth={stroke === "none" ? 0 : 2} />
        {/* shine */}
        <path d={`M${s.w * 0.12} ${s.light[1] + 2} Q${s.w * 0.5} ${s.light[1] - 6} ${s.w * 0.92} ${s.light[1] - 2}`} stroke="#fff" strokeOpacity={0.45} strokeWidth={5} fill="none" strokeLinecap="round" />
        {s.win.map((d, i) => <path key={i} d={d} fill={night ? "#3c4d6b" : "#bfe3f2"} stroke={INK} strokeOpacity={0.25} strokeWidth={2} />)}
        {s.win.map((d, i) => <path key={`g${i}`} d={d} fill="url(#gsGlass)" />)}
        {s.doors.map((dx) => <line key={dx} x1={dx} y1={s.light[1] - 12} x2={dx} y2={s.h - 30} stroke={INK} strokeOpacity={0.2} strokeWidth={2} />)}
        {s.doors.map((dx) => <rect key={`h${dx}`} x={dx + 12} y={s.light[1] - 2} width={16} height={4} rx={2} fill={INK} opacity={0.35} />)}
        <rect x={s.mirror[0]} y={s.mirror[1]} width={12} height={8} rx={3} fill={color} stroke={INK} strokeOpacity={0.3} />
        <rect x={s.light[0]} y={s.light[1]} width={16} height={9} rx={4} fill="#fff6c7" stroke={INK} strokeOpacity={0.3} />
        <rect x={s.tail[0]} y={s.tail[1]} width={8} height={12} rx={3} fill="#ff5a4f" />
        {decal && <text x={s.doors[0] + 8} y={s.h - 38} fontSize={13} fontWeight={900} fill="#fff" opacity={0.85} fontFamily="Inter, sans-serif">DSR</text>}
        {s.wheels.map(([cx, cy, r]) => (
          <g key={cx}>
            <circle cx={cx} cy={cy} r={r} fill="#1f1f22" />
            <circle cx={cx} cy={cy} r={r * 0.52} fill="#cfd3d8" />
            <circle cx={cx} cy={cy} r={r * 0.18} fill="#8a8f96" />
          </g>
        ))}
      </g>
    </g>
  );
}

function TrafficCar({ color, className, y }) {
  return (
    <g transform={`translate(0,${y})`}>
      <g className={className}>
        <path d="M4 34 Q2 24 12 22 L36 20 Q48 6 62 6 L108 6 Q118 6 124 18 L130 22 Q138 26 136 34 Z" fill={color} />
        <path d="M42 21 Q52 10 62 10 L80 10 L80 21 Z M86 10 L106 10 Q114 10 118 21 L86 21 Z" fill="#cfe9f5" opacity={0.9} />
        <circle cx={30} cy={35} r={8} fill="#222" /><circle cx={110} cy={35} r={8} fill="#222" />
      </g>
    </g>
  );
}

// ─── The scene ──────────────────────────────────────────────────────────────
export default function GarageScene({ night, bind, active, waving, labels, clock }) {
  const L = labels;
  const N = (day, nightColor) => (night ? nightColor : day);
  const { h, m, s } = clock;
  const hourDeg = (h % 12) * 30 + m * 0.5;
  const minDeg = m * 6;

  return (
    <>
      {/* ── 1. Sky, hills, city & street (visible through the windows) ── */}
      <Layer depth={6} className="gs-intro">
        <defs>
          <linearGradient id="gsSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={N("#8fd3ff", "#121a3d")} />
            <stop offset="1" stopColor={N("#fff1d6", "#4a3a6b")} />
          </linearGradient>
          <radialGradient id="gsSun"><stop offset="0" stopColor={N("#fff3b0", "#fffbe8")} /><stop offset="1" stopColor={N("#ffd36b", "#e6e2c8")} stopOpacity={0} /></radialGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#gsSky)" />
        <circle cx="1250" cy="170" r={N(110, 80)} fill="url(#gsSun)" />
        <circle cx="1250" cy="170" r={N(44, 32)} fill={N("#ffd23f", "#f4f0d8")} />
        {night && <circle cx="1238" cy="162" r="7" fill="#dcd6b8" />}
        {night && [[120, 150], [260, 120], [330, 210], [1120, 140], [1330, 120], [1180, 230], [200, 250]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2.2} fill="#fff" className="gs-twinkle" style={{ animationDelay: `${-i * 0.7}s` }} />
        ))}
        <g className="gs-cloud-a"><g transform="translate(0,140)" opacity={N(0.95, 0.25)} fill="#fff"><ellipse cx="60" cy="20" rx="60" ry="22" /><ellipse cx="110" cy="8" rx="44" ry="26" /><ellipse cx="150" cy="22" rx="46" ry="18" /></g></g>
        <g className="gs-cloud-b"><g transform="translate(0,210)" opacity={N(0.85, 0.2)} fill="#fff"><ellipse cx="40" cy="14" rx="40" ry="16" /><ellipse cx="80" cy="6" rx="34" ry="20" /></g></g>
        <g className="gs-cloud-c"><g transform="translate(0,115)" opacity={N(0.8, 0.2)} fill="#fff"><ellipse cx="50" cy="16" rx="52" ry="18" /><ellipse cx="96" cy="8" rx="36" ry="20" /></g></g>
        {/* Bandung hills */}
        <path d="M0 320 Q160 230 330 290 Q450 250 560 280 L760 300 Q900 220 1040 280 Q1190 236 1320 286 Q1460 250 1600 300 V420 H0 Z" fill={N("#a8d5a0", "#2a3658")} />
        <path d="M0 340 Q220 290 420 330 Q640 300 840 334 Q1060 296 1260 330 Q1440 306 1600 334 V420 H0 Z" fill={N("#83c07c", "#222c4a")} />
        {/* skyline */}
        {[[40, 60], [100, 84], [160, 50], [215, 96], [280, 64], [1060, 70], [1120, 100], [1185, 58], [1240, 90], [1300, 66]].map(([x, hh], i) => (
          <g key={i}>
            <rect x={x} y={360 - hh} width={50} height={hh} fill={N("#efe2d2", "#3a4470")} />
            {[0, 1, 2].map((r) => <rect key={r} x={x + 10} y={366 - hh + r * 22} width={10} height={9} fill={N("#c9d8e2", "#ffd76a")} opacity={N(0.8, (i + r) % 3 ? 0.9 : 0.2)} />)}
            {[0, 1, 2].map((r) => <rect key={`b${r}`} x={x + 28} y={366 - hh + r * 22} width={10} height={9} fill={N("#c9d8e2", "#ffd76a")} opacity={N(0.8, (i + r) % 2 ? 0.85 : 0.15)} />)}
          </g>
        ))}
        {/* street */}
        <rect y="356" width="1600" height="56" fill={N("#6d6a70", "#2b2b3a")} />
        <line x1="0" y1="384" x2="1600" y2="384" stroke="#f4e9c8" strokeWidth="3" strokeDasharray="26 22" opacity={0.7} />
        <rect y="410" width="1600" height="20" fill={N("#d9c7b4", "#4a4050")} />
        <TrafficCar color="#3b82f6" className="gs-traffic-r" y={334} />
        <TrafficCar color="#f59e0b" className="gs-traffic-r2" y={334} />
        <TrafficCar color="#10b981" className="gs-traffic-l" y={358} />
      </Layer>

      {/* ── 2. Wall: windows, sign, boards, map, photos, door, clock, lamps ── */}
      <Layer depth={12} className="gs-intro" style={{ animationDelay: "0.08s" }}>
        <defs>
          <mask id="gsWindows">
            <rect width="1600" height="900" fill="#fff" />
            <path d="M60 400 V230 Q60 100 220 100 Q380 100 380 230 V400 Z" fill="#000" />
            <path d="M1050 400 V230 Q1050 100 1210 100 Q1370 100 1370 230 V400 Z" fill="#000" />
          </mask>
          <filter id="gsNeon" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id="gsPool"><stop offset="0" stopColor="#ffd98a" stopOpacity={0.55} /><stop offset="1" stopColor="#ffd98a" stopOpacity={0} /></radialGradient>
          <linearGradient id="gsCone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe6a8" stopOpacity={0.5} /><stop offset="1" stopColor="#ffe6a8" stopOpacity={0} /></linearGradient>
        </defs>
        <g mask="url(#gsWindows)">
          <rect width="1600" height="640" fill={N("#fbeee0", "#ecd6c2")} />
          {/* exposed brick patches */}
          {[[20, 60], [470, 440], [1000, 60], [1390, 470], [520, 90], [30, 560]].map(([x, y], i) => (
            <g key={i} opacity={0.55}>
              {[0, 1, 2].map((r) => <rect key={r} x={x + (r % 2) * 14} y={y + r * 16} width={40} height={12} rx={2} fill="#efcfb6" />)}
              {[0, 1, 2].map((r) => <rect key={`b${r}`} x={x + 46 + (r % 2) * 14} y={y + r * 16} width={40} height={12} rx={2} fill="#efcfb6" />)}
            </g>
          ))}
          <rect y="462" width="1600" height="140" fill={N("#f4e1cf", "#e0c8b2")} />
          {Array.from({ length: 16 }, (_, i) => <rect key={i} x={i * 100 + 14} y={476} width={72} height={112} rx={6} fill="none" stroke="#e5ccb5" strokeWidth={3} />)}
          <rect y="600" width="1600" height="22" fill={RED} />
          <rect y="0" width="1600" height="48" fill={INK} />
          {Array.from({ length: 9 }, (_, i) => <rect key={i} x={i * 190 + 40} y={36} width={60} height={6} rx={3} fill="#4a3f3b" />)}
        </g>
        {/* window frames + sills */}
        {[60, 1050].map((x) => (
          <g key={x}>
            <path d={`M${x} 400 V230 Q${x} 100 ${x + 160} 100 Q${x + 320} 100 ${x + 320} 230 V400 Z`} fill="none" stroke={INK} strokeWidth={14} />
            <line x1={x + 160} y1={104} x2={x + 160} y2={400} stroke={INK} strokeWidth={8} />
            <line x1={x + 4} y1={250} x2={x + 316} y2={250} stroke={INK} strokeWidth={8} />
            <rect x={x - 18} y={398} width={356} height={16} rx={4} fill="#a8714b" />
            {night && <rect x={x} y={100} width={320} height={300} fill="#0b1030" opacity={0.08} />}
          </g>
        ))}
        {/* sill cactus */}
        <g transform="translate(320,350)"><rect x="0" y="34" width="34" height="16" rx="3" fill="#c75b3a" /><g className="gs-leaf"><rect x="11" y="0" width="12" height="38" rx="6" fill="#4f9a54" /><rect x="0" y="12" width="10" height="16" rx="5" fill="#4f9a54" /></g></g>

        {/* lamps */}
        {[490, 1030].map((x, i) => (
          <g key={x}>
            <g className={`gs-swing ${i ? "b" : ""}`} style={{ transformOrigin: `${x}px 48px` }}>
              {night && <path d={`M${x - 24} 128 L${x - 120} 470 L${x + 120} 470 L${x + 24} 128 Z`} fill="url(#gsCone)" />}
              <line x1={x} y1={48} x2={x} y2={104} stroke={INK} strokeWidth={3} />
              <path d={`M${x - 30} 130 L${x - 14} 104 L${x + 14} 104 L${x + 30} 130 Z`} fill={RED} />
              <ellipse cx={x} cy={131} rx={14} ry={5} fill={night ? "#fff2b8" : "#ffe9a8"} />
            </g>
          </g>
        ))}

        {/* neon sign → about */}
        <Hot id="about" label={L.about} tag={[968, 164]} bind={bind} active={active}>
          <g className="gs-lift">
            <rect x="565" y="62" width="430" height="90" rx="16" fill="#241c1c" />
            <rect x="565" y="62" width="430" height="90" rx="16" fill="none" stroke="#4a3a36" strokeWidth="4" />
            <g className="gs-neon" filter="url(#gsNeon)">
              <text x="780" y="114" textAnchor="middle" fontSize="44" fontWeight="900" fill="#ff4146" fontFamily="Outfit, Inter, sans-serif" letterSpacing="3">DSR SOLUTION</text>
            </g>
            <text x="780" y="140" textAnchor="middle" fontSize="15" fontWeight="700" fill="#ffd9a0" letterSpacing="5" fontFamily="Inter, sans-serif">GARASI · BUAH BATU</text>
            <rect className="gs-glow" x="560" y="57" width="440" height="100" rx="18" fill="none" stroke="#ff4146" strokeWidth="3" opacity={0} />
          </g>
        </Hot>

        {/* whiteboard → schedule */}
        <Hot id="schedule" label={L.schedule} tag={[690, 180]} bind={bind} active={active}>
          <g className="gs-lift">
            <rect x="556" y="182" width="268" height="206" rx="8" fill="#cfd6dc" />
            <rect x="566" y="192" width="248" height="186" rx="4" fill="#fdfefe" />
            <text x="580" y="222" fontSize="22" fill={RED} className="gs-chalk" fontWeight="700">Jadwal</text>
            {["S", "S", "R", "K", "J", "S", "M"].map((d, i) => <text key={i} x={588 + i * 32} y={250} fontSize="12" fill="#64748b" fontWeight="700" fontFamily="Inter, sans-serif">{d}</text>)}
            {[0, 1, 2].map((r) => <line key={r} x1={578} y1={262 + r * 36} x2={804} y2={262 + r * 36} stroke="#e2e8f0" strokeWidth={2} />)}
            {[[0, 0, "#22c55e"], [1, 0, "#22c55e"], [2, 0, "#f59e0b"], [4, 0, "#22c55e"], [0, 1, "#ef4444"], [3, 1, "#22c55e"], [5, 1, "#22c55e"], [1, 2, "#f59e0b"], [2, 2, "#22c55e"], [6, 2, "#22c55e"], [4, 2, "#ef4444"]].map(([c, r, f], i) => (
              <circle key={i} className="gs-magnet" cx={592 + c * 32} cy={282 + r * 36} r={9} fill={f} stroke="#fff" strokeWidth={2} style={{ transitionDelay: `${i * 25}ms` }} />
            ))}
            <rect x="600" y="388" width="180" height="10" rx="3" fill="#b9c2ca" />
            <rect x="620" y="382" width="34" height="6" rx="3" fill={RED} /><rect x="664" y="382" width="34" height="6" rx="3" fill="#2563eb" />
            <rect className="gs-glow" x="552" y="178" width="276" height="214" rx="10" fill="none" stroke={RED} strokeWidth="3" />
          </g>
        </Hot>

        {/* chalk menu board → packages */}
        <Hot id="packages" label={L.packages} tag={[930, 176]} bind={bind} active={active}>
          <g className="gs-lift">
            <rect x="845" y="178" width="172" height="232" rx="10" fill="#8a5a3a" />
            <rect x="856" y="189" width="150" height="210" rx="6" fill="#2f3b35" />
            <text x="931" y="224" textAnchor="middle" fontSize="24" fill="#fff" className="gs-chalk" fontWeight="700">MENU</text>
            <line x1="878" y1="234" x2="984" y2="234" stroke="#fff" strokeOpacity={0.5} strokeDasharray="4 5" />
            {[["Lepas Kunci", 266], ["+ Driver", 306], ["All In ★", 346]].map(([tx, y]) => (
              <g key={tx}>
                <circle cx="874" cy={y - 5} r="4" fill="#ffd36b" />
                <text x="886" y={y} fontSize="16" fill="#f8fafc" className="gs-chalk">{tx}</text>
              </g>
            ))}
            <text x="931" y="384" textAnchor="middle" fontSize="12" fill="#ffd36b" className="gs-chalk">tanya harga →</text>
            <rect className="gs-glow" x="841" y="174" width="180" height="240" rx="12" fill="none" stroke="#ffd36b" strokeWidth="3" />
          </g>
        </Hot>

        {/* folded map → location */}
        <Hot id="location" label={L.location} tag={[470, 228]} bind={bind} active={active}>
          <g className="gs-lift">
            <path d="M404 236 L446 230 L490 238 L534 230 L534 396 L490 404 L446 396 L404 402 Z" fill="#fff7e8" stroke="#e7d3b8" strokeWidth={2} />
            <path d="M446 230 L446 396 M490 238 L490 404" stroke="#e7d3b8" strokeWidth={2} />
            <path d="M410 300 Q460 280 500 320 T532 330" stroke="#9bd0a1" strokeWidth={10} fill="none" opacity={0.7} />
            <path d="M410 360 L530 270 M430 250 L470 400" stroke="#f3b2a0" strokeWidth={5} fill="none" />
            <path d="M408 330 L532 350" stroke="#94b8e8" strokeWidth={6} fill="none" />
            <g transform="translate(456,298)"><g className="gs-bob"><path d="M14 0 C6 0 0 6 0 14 C0 24 14 38 14 38 C14 38 28 24 28 14 C28 6 22 0 14 0 Z" fill={RED} /><circle cx="14" cy="14" r="5" fill="#fff" /></g></g>
            <rect className="gs-glow" x="400" y="226" width="138" height="182" rx="6" fill="none" stroke={RED} strokeWidth="3" />
          </g>
        </Hot>

        {/* polaroid string → trust */}
        <Hot id="trust" label={L.trust} tag={[225, 432]} bind={bind} active={active}>
          <g className="gs-lift">
            <path d="M60 438 Q225 470 390 438" stroke="#8a5a3a" strokeWidth={3} fill="none" />
            {[[78, -6, "#ffe0e0"], [158, 4, "#e0f2fe"], [238, -3, "#fef3c7"], [318, 6, "#dcfce7"]].map(([x, rot, bg], i) => (
              <g key={x} transform={`translate(${x},${446 + (i === 1 || i === 2 ? 8 : 0)}) rotate(${rot})`}>
                <rect width="62" height="74" rx="3" fill="#fff" stroke="#e5e7eb" />
                <rect x="6" y="6" width="50" height="46" fill={bg} />
                <circle cx="31" cy="24" r="9" fill="#f2c6a0" /><path d="M18 52 Q31 34 44 52 Z" fill={["#e3262d", "#2563eb", "#f59e0b", "#16a34a"][i]} />
                <text x="31" y="66" textAnchor="middle" fontSize="9" fill="#f59e0b">★★★★★</text>
                <rect x="25" y="-6" width="12" height="12" rx="2" fill="#c9875a" />
              </g>
            ))}
            <rect className="gs-glow" x="56" y="430" width="340" height="110" rx="10" fill="none" stroke={RED} strokeWidth="3" />
          </g>
        </Hot>

        {/* clock (real WIB time) */}
        <g>
          <circle cx="1485" cy="150" r="40" fill="#fff" stroke={INK} strokeWidth="6" />
          {Array.from({ length: 12 }, (_, i) => <line key={i} x1="1485" y1="116" x2="1485" y2={i % 3 ? 120 : 124} stroke={INK} strokeWidth={i % 3 ? 2 : 3} transform={`rotate(${i * 30} 1485 150)`} />)}
          <line x1="1485" y1="150" x2="1485" y2="128" stroke={INK} strokeWidth="5" strokeLinecap="round" transform={`rotate(${hourDeg} 1485 150)`} />
          <line x1="1485" y1="150" x2="1485" y2="120" stroke={INK} strokeWidth="3" strokeLinecap="round" transform={`rotate(${minDeg} 1485 150)`} />
          <line className="gs-hand-s" style={{ transformOrigin: "1485px 150px", animationDelay: `-${s}s` }} x1="1485" y1="156" x2="1485" y2="118" stroke={RED} strokeWidth="2" />
          <circle cx="1485" cy="150" r="4" fill={RED} />
        </g>

        {/* staff door → login */}
        <Hot id="login" label={L.login} tag={[1485, 228]} bind={bind} active={active}>
          <g className="gs-lift">
            <rect x="1402" y="226" width="166" height="396" rx="6" fill="#a8714b" />
            <rect x="1412" y="236" width="146" height="386" rx="4" fill="#3b302c" />
            <rect className="gs-glow" x="1552" y="240" width="6" height="380" fill="#ffd98a" />
            <rect x="1436" y="262" width="98" height="70" rx="6" fill={N("#bfe3f2", "#ffd98a")} opacity={0.75} />
            <rect x="1436" y="356" width="98" height="110" rx="6" fill="none" stroke="#54463f" strokeWidth={4} />
            <rect x="1436" y="484" width="98" height="110" rx="6" fill="none" stroke="#54463f" strokeWidth={4} />
            <rect x="1444" y="340" width="82" height="22" rx="4" fill="#fff" />
            <text x="1485" y="356" textAnchor="middle" fontSize="12" fontWeight="900" fill={INK} fontFamily="Inter, sans-serif" letterSpacing="1">STAFF ONLY</text>
            <circle cx="1540" cy="440" r="7" fill="#f6c33b" />
          </g>
        </Hot>
      </Layer>

      {/* ── 3. Floor + cars ── */}
      <Layer depth={20} className="gs-intro" style={{ animationDelay: "0.16s" }}>
        <defs>
          <linearGradient id="gsBeam" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stopColor="#fff6c7" stopOpacity={0.85} /><stop offset="1" stopColor="#fff6c7" stopOpacity={0} /></linearGradient>
          <linearGradient id="gsGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity={0.55} /><stop offset="0.45" stopColor="#fff" stopOpacity={0} /></linearGradient>
          <linearGradient id="gsFloor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={N("#e6d2bd", "#cdb59d")} /><stop offset="1" stopColor={N("#f3e5d6", "#dcc6b0")} /></linearGradient>
        </defs>
        <rect y="620" width="1600" height="280" fill="url(#gsFloor)" />
        {[648, 690, 748, 822].map((y) => <line key={y} x1="0" y1={y} x2="1600" y2={y} stroke="#d9c0a8" strokeWidth={2} />)}
        {Array.from({ length: 17 }, (_, i) => {
          const xt = i * 100;
          return <line key={i} x1={xt} y1={620} x2={800 + (xt - 800) * 2.17} y2={900} stroke="#d9c0a8" strokeWidth={2} />;
        })}
        {/* parking bays */}
        {[30, 390, 650].map((x, i) => <path key={x} d={`M${x} 822 L${x + [350, 250, 370][i]} 822`} stroke="#f6c33b" strokeWidth={6} strokeLinecap="round" opacity={0.8} />)}
        {night && <ellipse cx="490" cy="700" rx="260" ry="60" fill="url(#gsPool)" />}
        {night && <ellipse cx="1030" cy="700" rx="260" ry="60" fill="url(#gsPool)" />}

        <Hot id="car:MPV" label={L.mpv} tag={[210, 646]} bind={bind} active={active}>
          <Car kind="mpv" color={RED} x={34} ground={802} night={night} />
        </Hot>
        <Hot id="car:City Car" label={L.city} tag={[520, 670]} bind={bind} active={active}>
          <Car kind="city" color="#f6c33b" x={396} ground={806} night={night} />
        </Hot>
        <Hot id="car:SUV" label={L.suv} tag={[836, 652]} bind={bind} active={active}>
          <Car kind="suv" color="#f6f6f3" stroke="#c9ccd1" x={660} ground={816} night={night} decal={false} />
        </Hot>
      </Layer>

      {/* ── 4. Front desk, receptionist, standee, plant ── */}
      <Layer depth={32} className="gs-intro" style={{ animationDelay: "0.24s" }}>
        {/* receptionist (behind the counter) */}
        <g className={waving ? "gs-waving" : ""}>
          <g className="gs-breathe">
            <path d="M1168 650 Q1166 560 1200 540 L1262 540 Q1296 560 1294 650 Z" fill={RED} />
            <path d="M1214 540 L1231 566 L1248 540 Z" fill="#fff" />
            <text x="1231" y="610" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff" fontFamily="Inter, sans-serif">DSR</text>
            <rect x="1221" y="522" width="20" height="22" rx="6" fill="#e9b892" />
            <circle cx="1231" cy="500" r="32" fill="#f2c6a0" />
            <path d="M1199 498 Q1198 462 1231 462 Q1266 462 1264 500 Q1256 480 1234 478 Q1212 480 1199 498 Z" fill="#2b1d1a" />
            <ellipse className="gs-blink" cx="1220" cy="503" rx="3.4" ry="4.4" fill={INK} />
            <ellipse className="gs-blink" cx="1243" cy="503" rx="3.4" ry="4.4" fill={INK} />
            <path d="M1222 516 Q1231 524 1241 516" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
            <circle cx="1212" cy="514" r="5" fill="#f59f9f" opacity={0.5} /><circle cx="1251" cy="514" r="5" fill="#f59f9f" opacity={0.5} />
          </g>
          <g className="gs-wave">
            <path d="M1284 562 Q1314 548 1322 508" stroke={RED} strokeWidth="18" strokeLinecap="round" fill="none" />
            <circle cx="1323" cy="500" r="11" fill="#f2c6a0" />
          </g>
        </g>

        {/* counter */}
        <ellipse cx="1215" cy="872" rx="210" ry="16" fill="#000" opacity={0.14} />
        <path d="M1036 650 L1394 650 L1394 866 L1036 866 Z" fill={INK} />
        <rect x="1036" y="700" width="358" height="34" fill={RED} />
        <text x="1215" y="723" textAnchor="middle" fontSize="15" fontWeight="900" fill="#fff" letterSpacing="4" fontFamily="Inter, sans-serif">SELAMAT DATANG</text>
        <circle cx="1215" cy="800" r="34" fill="#fff" /><text x="1215" y="808" textAnchor="middle" fontSize="20" fontWeight="900" fill={RED} fontFamily="Outfit, Inter, sans-serif">DSR</text>
        <rect x="1020" y="628" width="390" height="24" rx="8" fill="#a8714b" />
        <rect x="1020" y="628" width="390" height="7" rx="4" fill="#c58a5f" />
        {/* monitor + coffee */}
        <rect x="1150" y="580" width="56" height="44" rx="5" fill="#9aa3ad" /><rect x="1172" y="622" width="12" height="8" fill="#9aa3ad" />
        <g transform="translate(1366,598)">
          <rect x="0" y="8" width="22" height="24" rx="4" fill="#fff" stroke="#e5e7eb" /><path d="M22 14 Q32 18 22 26" stroke="#e5e7eb" strokeWidth={3} fill="none" />
          <g className="gs-steam"><path d="M6 4 Q2 -4 8 -10" stroke="#cbd5e1" strokeWidth={2} fill="none" /></g>
          <g className="gs-steam b"><path d="M14 4 Q10 -4 16 -10" stroke="#cbd5e1" strokeWidth={2} fill="none" /></g>
        </g>

        {/* clipboard → order */}
        <Hot id="order" label={L.order} tag={[1092, 552]} bind={bind} active={active}>
          <g className="gs-lift">
            <g transform="rotate(-6 1090 596)">
              <rect x="1052" y="558" width="78" height="76" rx="7" fill="#8a5a3a" />
              <rect x="1059" y="566" width="64" height="62" rx="3" fill="#fff" />
              <rect x="1076" y="552" width="30" height="12" rx="4" fill="#b8bec6" />
              {[580, 594, 608].map((y) => <g key={y}><path d={`M1064 ${y} l4 4 l7 -8`} stroke="#16a34a" strokeWidth={2.4} fill="none" /><rect x="1080" y={y - 3} width="36" height="5" rx="2" fill="#e2e8f0" /></g>)}
              <rect x="1064" y="616" width="40" height="7" rx="3" fill={RED} />
            </g>
            <rect className="gs-glow" x="1044" y="546" width="96" height="96" rx="12" fill="none" stroke={RED} strokeWidth="3" />
          </g>
        </Hot>

        {/* phone → whatsapp */}
        <Hot id="whatsapp" label={L.whatsapp} tag={[1318, 580]} bind={bind} active={active}>
          <g className="gs-lift">
            <g transform="translate(1302,586)">
              <g className="gs-ring">
                <rect width="32" height="44" rx="6" fill={INK} />
                <rect x="3" y="4" width="26" height="34" rx="3" fill="#25D366" />
                <path d="M16 12 a8 8 0 1 0 0 16 l-1 0 l-5 2 l1.5 -4.5 A8 8 0 0 1 16 12 Z" fill="#fff" />
              </g>
            </g>
            <rect className="gs-glow" x="1294" y="580" width="48" height="56" rx="10" fill="none" stroke="#25D366" strokeWidth="3" />
          </g>
        </Hot>

        {/* A-frame standee → corporate */}
        <Hot id="corporate" label={L.corporate} tag={[1516, 650]} bind={bind} active={active}>
          <g className="gs-lift">
            <ellipse className="gs-shadow" cx="1516" cy="884" rx="80" ry="9" fill="#000" opacity={0.16} />
            <path d="M1456 880 L1474 660 M1576 880 L1558 660" stroke="#8a5a3a" strokeWidth="8" strokeLinecap="round" />
            <rect x="1462" y="656" width="108" height="170" rx="8" fill="#fff" stroke="#e5e7eb" strokeWidth={2} />
            <rect x="1462" y="656" width="108" height="36" rx="8" fill={RED} />
            <text x="1516" y="680" textAnchor="middle" fontSize="12" fontWeight="900" fill="#fff" fontFamily="Inter, sans-serif">KORPORAT</text>
            <g fill="#cbd5e1"><rect x="1496" y="704" width="40" height="52" rx="3" /></g>
            {[0, 1, 2].map((r) => [0, 1].map((c) => <rect key={`${r}${c}`} x={1502 + c * 16} y={710 + r * 14} width={10} height={8} fill="#fff" />))}
            <text x="1516" y="778" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK} fontFamily="Inter, sans-serif">Kontrak</text>
            <text x="1516" y="794" textAnchor="middle" fontSize="11" fontWeight="700" fill={INK} fontFamily="Inter, sans-serif">bulanan &</text>
            <text x="1516" y="810" textAnchor="middle" fontSize="11" fontWeight="700" fill={RED} fontFamily="Inter, sans-serif">tagihan 1x</text>
          </g>
        </Hot>

        {/* foreground plant */}
        <g transform="translate(-30,640)">
          <path d="M40 260 L52 190 L112 190 L124 260 Z" fill="#c75b3a" />
          <g className="gs-leaf">
            <path d="M82 192 Q20 150 30 70 Q70 110 82 192 Z" fill="#3f8f4a" />
            <path d="M82 192 Q140 140 140 60 Q96 104 82 192 Z" fill="#4f9a54" />
            <path d="M82 192 Q70 110 96 30 Q110 120 82 192 Z" fill="#5fae5f" />
          </g>
        </g>
      </Layer>
    </>
  );
}
