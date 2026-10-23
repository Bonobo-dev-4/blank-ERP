import { DemandForecast } from '@/components/app/demand-forecast';

export default function Page() {
  return (
    <DemandForecast
      title="Forecasting"
      description="Sales velocity per SKU, from imported order history. Rule-based on purpose: every figure can be reproduced by hand and argued with."
    />
  );
}
