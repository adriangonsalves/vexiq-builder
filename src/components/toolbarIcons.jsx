// Small icons for the 3D view's context bar, drawn like the lucide icons the app already uses.

function Icon({ size = 20, children, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

const MAGENTA = '#e879f9';

export function AddToSelectionIcon({ size = 20, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M3 3l6 14 2-5.5 5.5-2z" />
      <path d="M18 15.5v5M15.5 18h5" />
    </Icon>
  );
}

export function MarkHoleIcon({ size = 20, set = false, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <circle cx="12" cy="12" r="5" stroke={MAGENTA} />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      {set && <circle cx="12" cy="12" r="2" fill={MAGENTA} stroke="none" />}
    </Icon>
  );
}

export function JoinIcon({ size = 20, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="9" y="2" width="6" height="9" rx="3" />
      <path d="M12 13v4.5M10 15.5l2 2 2-2" />
      <path d="M3 19h6v1.5h6V19h6v3H3z" />
    </Icon>
  );
}

export function StampCopiesIcon({ size = 20, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="8" width="6" height="13" rx="3" fill="currentColor" stroke="none" />
      <rect x="14" y="10" width="6" height="11" rx="3" strokeDasharray="2 2.5" />
      <path d="M17 2.5v5M14.5 5h5" />
    </Icon>
  );
}

export function WorldArrowsIcon({ size = 20, on = false, ...rest }) {
  // The same tilted bar in both; off: its arrows tilt with it, on: the arrows stand upright
  return (
    <Icon size={size} {...rest}>
      <rect x="10" y="5" width="11" height="4" rx="1.5" transform="rotate(-30 15.5 7)" />
      <g transform={on ? undefined : 'rotate(-30 6 20)'}>
        <path d="M6 20V9M3.8 11.2L6 9l2.2 2.2" />
        <path d="M6 20h11M14.8 17.8L17 20l-2.2 2.2" />
      </g>
    </Icon>
  );
}

export function FreeMoveIcon({ size = 20, on = false, ...rest }) {
  // A pin over a beam's hole. Off (pulling on): pull lines draw the pin to the hole.
  // On (pulling off): the pin off to one side and a slash through the hole
  return (
    <Icon size={size} {...rest}>
      <rect x="3" y="15" width="18" height="6" rx="2" />
      {on ? (
        <>
          <rect x="3.5" y="2" width="5" height="8" rx="2.5" />
          <circle cx="15" cy="18" r="1.4" />
          <path d="M11.5 13L19 23" />
        </>
      ) : (
        <>
          <rect x="9.5" y="2" width="5" height="7" rx="2.5" />
          <circle cx="12" cy="18" r="1.4" />
          <path d="M12 10.5v2.5M8.5 10.5l1.5 2.5M15.5 10.5L14 13" />
        </>
      )}
    </Icon>
  );
}

export function TurnStepIcon({ size = 20, value = '', ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <path d="M6 15V3A12 12 0 0 1 18 15z" />
      <text
        x="12"
        y="22"
        fontSize="7"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
      >
        {value}
      </text>
    </Icon>
  );
}

export function GrowSelectionIcon({ size = 20, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
      <rect x="2" y="2" width="5" height="5" rx="1" />
      <rect x="17" y="17" width="5" height="5" rx="1" />
      <path d="M7 7l2 2M15 15l2 2" />
      <path d="M19 2.5v5M16.5 5h5" />
    </Icon>
  );
}

export function OnePartOfGroupIcon({ size = 20, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="2" y="3" width="20" height="18" rx="2" strokeDasharray="3 2.5" />
      <rect x="4.5" y="10" width="4" height="4" rx="0.5" />
      <rect x="10" y="10" width="4" height="4" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="15.5" y="10" width="4" height="4" rx="0.5" />
    </Icon>
  );
}

export function PinsOnlyIcon({ size = 20, ...rest }) {
  return (
    <Icon size={size} {...rest}>
      <rect x="8" y="2" width="8" height="20" rx="4" />
      <path d="M8 15h8" />
    </Icon>
  );
}
