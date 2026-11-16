import type { CSSProperties } from 'react';

export function Mark({ size = 36, bg = true }: { size?: number; bg?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      {bg && <rect width="512" height="512" rx="112" fill="#0E2A3B" />}
      <rect x="138" y="120" width="62" height="272" rx="31" fill="#FFB020" />
      <rect x="170" y="226" width="100" height="60" rx="30" fill="#FFB020" />
      <rect x="312" y="120" width="62" height="272" rx="31" fill="#EAF4F2" />
      <rect x="282" y="226" width="92" height="60" rx="30" fill="#EAF4F2" />
    </svg>
  );
}

export function Wordmark({ size = 18, light = true }: { size?: number; light?: boolean }) {
  const s: CSSProperties = { fontSize: size, color: light ? '#fff' : 'var(--ink)' };
  return <span className="wordmark" style={s}>HAND<b>OFF</b></span>;
}

const P: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5v-5h4v5h4.5V10',
  inbox: 'M3.5 13.5 6 5h12l2.5 8.5M3.5 13.5v5h17v-5M3.5 13.5h5l1.2 2.2h4.6l1.2-2.2h5',
  send: 'M4 12 20 4l-4.5 16-3.3-6.2L4 12Zm8.2 1.8L20 4',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.2a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  menu: 'M4 7h16M4 12h16M4 17h10',
  bell: 'M6 17.5V11a6 6 0 1 1 12 0v6.5l1.5 1.5h-15L6 17.5ZM10 21h4',
  history: 'M4 12a8 8 0 1 0 2.6-5.9L4 8.5M4 4v4.5h4.5M12 8v4.5l3 1.8',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800',
  camera: 'M4 8h3l1.5-2.5h7L17 8h3v11H4V8Zm8 8.500a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7Z',
  pdf: 'M7 3h7l4 4v14H7V3Zm7 0v4h4M9.500 13h5M9.500 16.500h5',
  check: 'm5 12.500 4.500 4.500L19 7.500',
  alert: 'M12 4 2.800 19.500h18.400L12 4Zm0 5.500v4.500m0 2.800v.2',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.500V12l3 2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7.500 8.500a7.500 7.500 0 0 1 15 0',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm9 5 7 7-7 7',
  back: 'm15 5-7 7 7 7',
  logout: 'M10 4H5v16h5M15 8l4 4-4 4M19 12H9',
  hand: 'M7 12V6.500a1.500 1.500 0 0 1 3 0V11m0-5.500a1.500 1.500 0 0 1 3 0V11m0-4a1.500 1.500 0 0 1 3 0v5.500m0-2.500a1.500 1.500 0 0 1 3 0v4.500A6.500 6.500 0 0 1 12.500 21h-1A6.500 6.500 0 0 1 5 14.500V12.500a1.500 1.500 0 0 1 2 0',
};
export function Ic({ n, size = 22, stroke = 1.9 }: { n: keyof typeof P | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[n] ?? P.plus} />
    </svg>
  );
}
