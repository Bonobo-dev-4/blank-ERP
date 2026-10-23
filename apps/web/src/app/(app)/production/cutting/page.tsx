'use client';

import { StageQueue } from '@/components/app/stage-queue';

export default function Page() {
  return (
    <StageQueue
      stageCode="CUTTING"
      title="Cutting"
      description="Batches at the cutting table. Quantities recorded here are bounded by what the stage is actually holding, so a repeated submission is refused rather than doubling the count."
    />
  );
}
