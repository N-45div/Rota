// Rota's mark: a week of shift blocks, two of them filled.
export function RotaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#E4572E" />
      <rect x="13" y="16" width="11" height="14" rx="3.5" fill="#FBF7F2" />
      <rect x="26.5" y="16" width="11" height="14" rx="3.5" fill="#FBF7F2" />
      <rect x="40" y="16" width="11" height="14" rx="3.5" fill="#2B211C" />
      <rect x="13" y="34" width="11" height="14" rx="3.5" fill="#2B211C" />
      <rect x="26.5" y="34" width="11" height="14" rx="3.5" fill="#FBF7F2" />
      <rect x="40" y="34" width="11" height="14" rx="3.5" fill="#FBF7F2" fillOpacity="0.55" />
    </svg>
  );
}
