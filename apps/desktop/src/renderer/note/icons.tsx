/** The note's three icons (lucide shapes), inline so the app needs no icon dependency. */
const Svg = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const CopyIcon = (): React.JSX.Element => (
  <Svg>
    <rect x="8" y="8" width="14" height="14" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Svg>
)

export const ChatIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Svg>
)

export const CloseIcon = (): React.JSX.Element => (
  <Svg>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
)
