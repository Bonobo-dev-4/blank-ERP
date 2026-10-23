import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <FileQuestion className="size-8 text-ink-subtle" />
      <h1 className="text-[16px] font-semibold text-ink">Page not found</h1>
      <p className="max-w-md text-[12.5px] text-ink-muted">
        This address does not match any screen in the ERP.
      </p>
      <Link href="/" className="text-[12.5px] font-medium text-brand hover:underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
