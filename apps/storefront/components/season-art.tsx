import type { ReactNode } from "react";
import type { SeasonTheme } from "@/lib/campaigns";

/**
 * Original, decorative season illustrations drawn in SVG (no stock art, no external files).
 * Colours come from the campaign, so a re-coloured season re-colours its art too.
 * Layout is deterministic (seeded by theme), so server and client render identically.
 */

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEART = "M50 88 C20 66 4 48 4 30 C4 14 16 4 30 4 C40 4 47 10 50 18 C53 10 60 4 70 4 C84 4 96 14 96 30 C96 48 80 66 50 88Z";
const MAPLE = "50,2 56,18 66,13 63,36 78,24 82,32 96,30 90,44 98,50 76,64 80,74 56,70 54,92 46,92 44,70 20,74 24,64 2,50 10,44 4,30 18,32 22,24 37,36 34,13 44,18";
const BAT = "M0 14 Q12 0 24 10 Q28 2 32 8 L35 4 L38 8 Q42 2 46 10 Q58 0 70 14 Q60 12 54 22 Q48 16 42 22 Q38 18 35 24 Q32 18 28 22 Q22 16 16 22 Q10 12 0 14Z";

type Colors = { accent: string; ink: string; bg: string };

const at = (x: number, y: number, s: number, r = 0) => `translate(${x} ${y}) rotate(${r}) scale(${s})`;

function Snowflake({ x, y, s, c, o = 1 }: { x: number; y: number; s: number; c: string; o?: number }) {
  return (
    <g transform={at(x, y, s)} stroke={c} strokeWidth={3 / s > 6 ? 6 : 3} strokeLinecap="round" opacity={o} fill="none">
      {[0, 60, 120].map((r) => (
        <g key={r} transform={`rotate(${r})`}>
          <line x1={-20} y1={0} x2={20} y2={0} />
          <polyline points="-14,-5 -10,0 -14,5" /><polyline points="14,-5 10,0 14,5" />
        </g>
      ))}
    </g>
  );
}

function Tree({ x, y, s, c, trunk }: { x: number; y: number; s: number; c: string; trunk: string }) {
  return (
    <g transform={at(x, y, s)}>
      <rect x={-6} y={60} width={12} height={18} fill={trunk} />
      <polygon points="0,-10 -30,30 30,30" fill={c} />
      <polygon points="0,8 -38,52 38,52" fill={c} />
      <polygon points="0,26 -46,70 46,70" fill={c} />
      <polygon points="0,-24 4,-14 15,-14 6,-8 9,3 0,-3 -9,3 -6,-8 -15,-14 -4,-14" fill="#f3c34b" />
    </g>
  );
}

function Ornament({ x, y, s, c, cap }: { x: number; y: number; s: number; c: string; cap: string }) {
  return (
    <g transform={at(x, y, s)}>
      <line x1={0} y1={-60} x2={0} y2={-24} stroke={cap} strokeWidth={1.5} />
      <rect x={-7} y={-26} width={14} height={8} rx={2} fill={cap} />
      <circle r={22} fill={c} />
      <path d="M-12 -8 A14 14 0 0 1 2 -15" stroke="#fff" strokeOpacity={0.6} strokeWidth={3} fill="none" strokeLinecap="round" />
    </g>
  );
}

function Pumpkin({ x, y, s, c, stem, face }: { x: number; y: number; s: number; c: string; stem: string; face?: string }) {
  return (
    <g transform={at(x, y, s)}>
      <rect x={-4} y={-38} width={8} height={14} rx={3} fill={stem} transform="rotate(10)" />
      <ellipse cx={-18} cy={0} rx={20} ry={26} fill={c} />
      <ellipse cx={18} cy={0} rx={20} ry={26} fill={c} />
      <ellipse cx={0} cy={0} rx={20} ry={28} fill={c} />
      <path d="M-8 -24 Q-14 0 -8 26 M8 -24 Q14 0 8 26" stroke="#000" strokeOpacity={0.12} strokeWidth={2} fill="none" />
      {face && <>
        <polygon points="-16,-6 -8,-14 -4,-4" fill={face} />
        <polygon points="16,-6 8,-14 4,-4" fill={face} />
        <path d="M-16 8 L-10 12 L-5 8 L0 13 L5 8 L10 12 L16 8 Q0 22 -16 8Z" fill={face} />
      </>}
    </g>
  );
}

function Flower({ x, y, s, petal, center }: { x: number; y: number; s: number; petal: string; center: string }) {
  return (
    <g transform={at(x, y, s)}>
      {[0, 60, 120, 180, 240, 300].map((r) => <ellipse key={r} cx={0} cy={-16} rx={9} ry={15} fill={petal} transform={`rotate(${r})`} />)}
      <circle r={9} fill={center} />
    </g>
  );
}

function Egg({ x, y, s, c, stripe, r }: { x: number; y: number; s: number; c: string; stripe: string; r: number }) {
  return (
    <g transform={at(x, y, s, r)}>
      <path d="M0 -34 C20 -34 28 0 28 12 C28 28 15 36 0 36 C-15 36 -28 28 -28 12 C-28 0 -20 -34 0 -34Z" fill={c} />
      <path d="M-27 6 L-18 -2 L-9 6 L0 -2 L9 6 L18 -2 L27 6" stroke={stripe} strokeWidth={4} fill="none" strokeLinejoin="round" />
      <path d="M-26 20 H26" stroke={stripe} strokeWidth={3} strokeDasharray="2 6" strokeLinecap="round" />
    </g>
  );
}

function Firework({ x, y, s, c }: { x: number; y: number; s: number; c: string }) {
  return (
    <g transform={at(x, y, s)} stroke={c} strokeWidth={3} strokeLinecap="round">
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        return <line key={i} x1={Math.cos(a) * 12} y1={Math.sin(a) * 12} x2={Math.cos(a) * 34} y2={Math.sin(a) * 34} />;
      })}
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6 + 0.26;
        return <circle key={`d${i}`} cx={Math.cos(a) * 44} cy={Math.sin(a) * 44} r={2.5} fill={c} stroke="none" />;
      })}
    </g>
  );
}

function Gift({ x, y, s, c, ribbon, r = 0 }: { x: number; y: number; s: number; c: string; ribbon: string; r?: number }) {
  return (
    <g transform={at(x, y, s, r)}>
      <rect x={-30} y={-16} width={60} height={44} rx={4} fill={c} />
      <rect x={-34} y={-28} width={68} height={14} rx={3} fill={c} />
      <rect x={-6} y={-28} width={12} height={56} fill={ribbon} />
      <path d="M0 -28 C-10 -46 -30 -40 -18 -30 Z M0 -28 C10 -46 30 -40 18 -30 Z" fill={ribbon} />
    </g>
  );
}

function Tag({ x, y, s, c, ink, r }: { x: number; y: number; s: number; c: string; ink: string; r: number }) {
  return (
    <g transform={at(x, y, s, r)}>
      <path d="M-40 -22 H24 L44 0 L24 22 H-40 Z" fill={c} />
      <circle cx={26} cy={0} r={5} fill="#fff" />
      <text x={-12} y={9} textAnchor="middle" fontSize={26} fontWeight={700} fill={ink} fontFamily="sans-serif">%</text>
    </g>
  );
}

function Confetti({ seed, c, n, w, h }: { seed: string; c: string[]; n: number; w: number; h: number }) {
  const r = rng(seed);
  return (
    <g>
      {Array.from({ length: n }, (_, i) => {
        const x = r() * w, y = r() * h, rot = r() * 180, fill = c[i % c.length];
        return r() > 0.5
          ? <rect key={i} x={x} y={y} width={10} height={4} rx={2} fill={fill} transform={`rotate(${rot} ${x} ${y})`} opacity={0.8} />
          : <circle key={i} cx={x} cy={y} r={3 + r() * 3} fill={fill} opacity={0.7} />;
      })}
    </g>
  );
}

function scene(theme: SeasonTheme, { accent, ink, bg }: Colors): ReactNode {
  const r = rng(theme);
  switch (theme) {
    case "christmas":
    case "winter":
      return (
        <>
          <path d="M0 330 Q150 290 300 320 T600 300 V400 H0Z" fill="#fff" opacity={0.85} />
          {Array.from({ length: 14 }, (_, i) => <Snowflake key={i} x={r() * 600} y={r() * 260} s={0.4 + r() * 0.7} c={theme === "winter" ? accent : "#b9c8d3"} o={0.5 + r() * 0.5} />)}
          {theme === "christmas" ? <>
            <Tree x={430} y={210} s={1.5} c="#2f6b46" trunk="#6b4a2f" />
            <Tree x={530} y={250} s={1.0} c="#3f8a5a" trunk="#6b4a2f" />
            <Tree x={340} y={262} s={0.8} c="#2f6b46" trunk="#6b4a2f" />
            <Ornament x={250} y={170} s={1.3} c={accent} cap="#d9b25b" />
            <Ornament x={320} y={140} s={0.9} c="#2f6b46" cap="#d9b25b" />
            <Gift x={190} y={300} s={1.1} c={accent} ribbon="#f3c34b" r={-6} />
            <Gift x={270} y={320} s={0.8} c="#2f6b46" ribbon="#fff" r={5} />
          </> : <>
            <path d="M0 360 Q200 300 420 350 T600 340 V400 H0Z" fill="#fff" />
          </>}
        </>
      );
    case "halloween":
      return (
        <>
          <circle cx={460} cy={110} r={78} fill="#f6d27a" />
          <circle cx={490} cy={95} r={78} fill={bg} opacity={0.15} />
          {Array.from({ length: 5 }, (_, i) => (
            <path key={i} d={BAT} fill={ink} transform={at(140 + r() * 380, 40 + r() * 150, 0.6 + r() * 0.6, -15 + r() * 30)} opacity={0.85} />
          ))}
          {Array.from({ length: 16 }, (_, i) => <circle key={`s${i}`} cx={r() * 600} cy={r() * 220} r={1.5 + r() * 1.5} fill={ink} opacity={0.35} />)}
          <path d="M0 350 Q300 310 600 345 V400 H0Z" fill={ink} opacity={0.12} />
          <Pumpkin x={400} y={318} s={1.6} c={accent} stem="#4b6b2f" face={ink} />
          <Pumpkin x={520} y={338} s={1.0} c="#f0954a" stem="#4b6b2f" />
          <Pumpkin x={290} y={344} s={0.8} c={accent} stem="#4b6b2f" />
        </>
      );
    case "valentines":
      return (
        <>
          {Array.from({ length: 18 }, (_, i) => {
            const s = 0.25 + r() * 0.9;
            return <path key={i} d={HEART} transform={at(r() * 560, r() * 330, s, -25 + r() * 50)}
                         fill={i % 3 === 0 ? "none" : i % 3 === 1 ? accent : "#f4a3b8"} stroke={accent} strokeWidth={i % 3 === 0 ? 4 / s : 0} opacity={0.9} />;
          })}
          <path d={HEART} transform={at(360, 120, 2.0, 8)} fill={accent} />
        </>
      );
    case "easter":
    case "spring":
      return (
        <>
          <path d="M0 330 Q200 300 400 330 T600 320 V400 H0Z" fill="#9cc58a" opacity={0.7} />
          {Array.from({ length: 9 }, (_, i) => <Flower key={i} x={40 + r() * 540} y={60 + r() * 240} s={0.6 + r() * 0.8} petal={i % 2 ? "#f6c3d4" : "#fff"} center="#f3c34b" />)}
          {theme === "easter" && <>
            <Egg x={400} y={300} s={1.3} c={accent} stripe="#fff" r={-8} />
            <Egg x={480} y={318} s={1.0} c="#a7d3e8" stripe={accent} r={10} />
            <Egg x={330} y={326} s={0.8} c="#f3d36b" stripe="#9cc58a" r={-2} />
          </>}
        </>
      );
    case "mothers_day":
      return (
        <>
          {Array.from({ length: 6 }, (_, i) => (
            <path key={`st${i}`} d={`M${430 + (i - 2.5) * 14} 380 Q${430 + (i - 2.5) * 30} 260 ${360 + i * 30} ${140 + (i % 3) * 30}`} stroke="#5f8a5a" strokeWidth={4} fill="none" />
          ))}
          {Array.from({ length: 6 }, (_, i) => <Flower key={i} x={360 + i * 30} y={140 + (i % 3) * 30} s={1 + (i % 2) * 0.4} petal={i % 2 ? accent : "#f6c3d4"} center="#f3c34b" />)}
          <path d={HEART} transform={at(120, 80, 0.7, -12)} fill={accent} opacity={0.6} />
          <path d={HEART} transform={at(200, 200, 0.4, 10)} fill={accent} opacity={0.4} />
        </>
      );
    case "fathers_day":
    case "summer":
      return (
        <>
          <circle cx={470} cy={110} r={60} fill="#f3c34b" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return <line key={i} x1={470 + Math.cos(a) * 74} y1={110 + Math.sin(a) * 74} x2={470 + Math.cos(a) * 96} y2={110 + Math.sin(a) * 96} stroke="#f3c34b" strokeWidth={6} strokeLinecap="round" />;
          })}
          {theme === "fathers_day" ? <>
            <polygon points="120,360 260,170 400,360" fill={accent} opacity={0.85} />
            <polygon points="300,360 430,210 600,360" fill={ink} opacity={0.75} />
            <polygon points="260,170 290,210 230,210" fill="#fff" />
          </> : <>
            {[0, 1, 2].map((i) => <path key={i} d={`M0 ${300 + i * 30} q50 -20 100 0 t100 0 t100 0 t100 0 t100 0 t100 0`} stroke={accent} strokeWidth={6} fill="none" opacity={0.7 - i * 0.2} />)}
          </>}
        </>
      );
    case "autumn":
    case "back_to_school":
      return (
        <>
          {Array.from({ length: 12 }, (_, i) => (
            <polygon key={i} points={MAPLE} transform={at(r() * 560, r() * 330, 0.4 + r() * 0.7, r() * 360)}
                     fill={["#c8462b", "#e08a2c", "#b5651d", accent][i % 4]} opacity={0.9} />
          ))}
        </>
      );
    case "black_friday":
      return (
        <>
          <Tag x={420} y={120} s={2.0} c={accent} ink="#fff" r={-12} />
          <Tag x={300} y={260} s={1.3} c="#f3c34b" ink={ink} r={10} />
          <Tag x={520} y={300} s={1.0} c="#fff" ink={ink} r={-4} />
          <Confetti seed="bf" c={[accent, "#f3c34b", ink]} n={24} w={600} h={380} />
        </>
      );
    case "new_year":
      return (
        <>
          <Firework x={430} y={120} s={1.8} c={accent} />
          <Firework x={250} y={80} s={1.0} c="#f3c34b" />
          <Firework x={530} y={260} s={1.1} c={ink} />
          <Confetti seed="ny" c={[accent, "#f3c34b", ink]} n={30} w={600} h={380} />
        </>
      );
    default:
      return (
        <>
          <Confetti seed="custom" c={[accent, "#f3c34b", ink]} n={26} w={600} h={380} />
          <Gift x={420} y={230} s={2.0} c={accent} ribbon="#f3c34b" r={-6} />
          <Gift x={520} y={300} s={1.1} c={ink} ribbon={accent} r={8} />
        </>
      );
  }
}

export function SeasonArt({ theme, accent, ink, bg, className = "" }: { theme: SeasonTheme } & Colors & { className?: string }) {
  return (
    <svg viewBox="0 0 600 400" preserveAspectRatio="xMaxYMax slice" aria-hidden focusable="false" className={className}>
      {scene(theme, { accent, ink, bg })}
    </svg>
  );
}

/** A thin repeating motif for the ribbon at the top of the site while a season is live. */
export function SeasonMotif({ theme, color }: { theme: SeasonTheme; color: string }) {
  const icon = (() => {
    switch (theme) {
      case "christmas": case "winter": return <Snowflake x={10} y={10} s={0.3} c={color} />;
      case "halloween": return <path d={BAT} transform={at(0, 4, 0.28)} fill={color} />;
      case "valentines": case "mothers_day": return <path d={HEART} transform={at(3, 2, 0.15)} fill={color} />;
      case "autumn": case "back_to_school": return <polygon points={MAPLE} transform={at(2, 1, 0.17)} fill={color} />;
      default: return <circle cx={10} cy={10} r={3} fill={color} />;
    }
  })();
  return (
    <svg width="100%" height="100%" aria-hidden focusable="false">
      <defs><pattern id={`m-${theme}`} width="40" height="20" patternUnits="userSpaceOnUse">{icon}</pattern></defs>
      <rect width="100%" height="100%" fill={`url(#m-${theme})`} />
    </svg>
  );
}
