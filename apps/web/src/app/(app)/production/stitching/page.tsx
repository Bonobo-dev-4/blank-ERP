'use client';

import { StageQueue } from '@/components/app/stage-queue';

export default function Page() {
  return (
    <StageQueue
      stageCode="STITCHING"
      title="Stitching"
      description="Batches on the stitching line. Rejected pieces leave the batch; reworked pieces stay in it."
    />
  );
}
