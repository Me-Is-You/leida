export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.35" />
      <circle cx="16" cy="16" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.7" />
      <circle cx="16" cy="16" r="2.2" fill="currentColor" />
      <path d="M16 16 L27 9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
