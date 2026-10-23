'use client';

import { StageQueue } from '@/components/app/stage-queue';

export default function Page() {
  return (
    <StageQueue
      stageCode="WASHING"
      title="Washing / Processing"
      description="Batches out for washing or processing. They are still counted against the order throughout."
    />
  );
}
