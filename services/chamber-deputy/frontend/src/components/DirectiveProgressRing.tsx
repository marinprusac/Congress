// Sits behind a directive row's play button: an arc that fills clockwise
// from nothing (just ran) to a full circle (due now) as a scheduled
// directive approaches its next trigger - no track drawn behind the
// unfilled portion, so an on-demand-only directive's plain play button and
// a scheduled one just past its own run look identical. Swaps to a spinning
// indeterminate arc the moment a run is actually in flight - see
// DirectivesListPage.tsx for where `fraction` (directiveProgressFraction)
// and `running` (the polled runningDirectiveId) come from.
const SIZE = 28;
const STROKE_WIDTH = 2;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function DirectiveProgressRing({ fraction, running }: { fraction: number | null; running: boolean }) {
  if (running) {
    return (
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="directive-progress-ring directive-progress-ring-spinning" aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * 0.25} ${CIRCUMFERENCE * 0.75}`}
        />
      </svg>
    );
  }

  if (fraction === null) return null;

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="directive-progress-ring" aria-hidden="true">
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
    </svg>
  );
}
