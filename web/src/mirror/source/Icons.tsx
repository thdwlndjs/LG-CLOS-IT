import type { CSSProperties } from "react";
const paths: Record<string, React.ReactNode> = {
  home: (
    <>
      <path d="m3 10 9-7 9 7M6 9v11h4v-6h4v6h4V9" />
    </>
  ),
  wardrobe: (
    <>
      <rect x="5" y="3" width="14" height="17" rx="3" />
      <path d="M12 3v17M9 10v3m6-3v3M7 20v2m10-2v2" />
    </>
  ),
  outfit: <path d="m8 3-6 3 3 5 3-1v11h8V10l3 1 3-5-6-3c0 4-8 4-8 0Z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M7 3v4m10-4v4" />
      <rect x="7" y="13" width="4" height="4" />
    </>
  ),
  care: (
    <>
      <circle cx="9" cy="9" r="6" />
      <circle cx="15" cy="14" r="5" />
      <circle cx="9" cy="20" r="2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21c0-11 16-11 16 0Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="m14 5-7 7 7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14" />
      <path d="M10 3H4v17h17v-6" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="2" />
      <path d="m3 17 6-6 4 4 3-3 5 5" />
    </>
  ),
  pin: (
    <>
      <path d="M18 9c0 5-6 12-6 12S6 14 6 9a6 6 0 0 1 12 0Z" />
      <circle cx="12" cy="9" r="2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 8A8 8 0 1 0 20 16M20 2v6h-6" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8Z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 11v6m0-10v1" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  list: <path d="M4 5h16M4 12h16M4 19h16" />,
  tools: (
    <>
      <path d="m4 20 12-12M16 3v5h5M4 4l16 16" />
    </>
  ),
};
export function Icon({
  name,
  size = 24,
  style,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {paths[name] || paths.info}
    </svg>
  );
}
