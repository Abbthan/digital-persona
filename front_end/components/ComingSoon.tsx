import Link from "next/link";

// Shared placeholder for routes that exist so navigation resolves, but whose
// real content arrives in a later phase.
export function ComingSoon({
  title,
  blurb,
  backHref,
}: {
  title: string;
  blurb: string;
  backHref?: string;
}) {
  return (
    <main className="flex min-h-screen flex-1 flex-col items-center justify-center bg-canvas px-lg pt-32 pb-section text-center">
      <h1 className="font-display text-display-lg text-ink">{title}</h1>
      <p className="mt-md w-full max-w-[28rem] font-text text-body text-ink-muted-80">{blurb}</p>
      {backHref && (
        <Link
          href={backHref}
          className="mt-lg inline-flex rounded-pill px-sm py-xs font-text text-caption text-ink-muted-80 transition-colors duration-150 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus focus-visible:ring-offset-2"
        >
          Go Back
        </Link>
      )}
    </main>
  );
}
