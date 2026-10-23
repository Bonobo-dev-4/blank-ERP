'use client';

import { StageQueue } from '@/components/app/stage-queue';

export default function Page() {
  return (
    <StageQueue
      stageCode="FINISHING"
      title="Finishing"
      description="Batches at finishing — the last step before quality control on the standard route."
    />
  );
}
