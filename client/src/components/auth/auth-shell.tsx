import Link from "next/link";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12 sm:py-20">
      <Link href="/" className="mb-8 block text-center font-serif text-2xl font-semibold tracking-[0.28em] text-primary">
        PAYANTRA
      </Link>
      <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <h1 className="text-3xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}
