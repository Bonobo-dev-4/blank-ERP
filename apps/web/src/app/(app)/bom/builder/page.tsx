'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LoadingBlock } from '@/components/ui/primitives';

/**
 * The BOM builder is the line editor, and it only makes sense in the context of
 * a BOM. Creating one starts at /bom/new; editing a draft happens inside
 * /bom/[id]. Rather than a third place that does the same thing, this entry
 * sends the reader to the one that creates.
 */
export default function BomBuilderPage() {
  const router = useRouter();
  React.useEffect(() => {
    router.replace('/bom/new');
  }, [router]);
  return <LoadingBlock label="Opening the BOM builder" />;
}
