import { DemandForecast } from '@/components/app/demand-forecast';

export default function Page() {
  return (
    <DemandForecast
      title="Demand forecast"
      description="What the next period looks like per SKU, driven by demand net of cancellation and refund rather than gross orders."
    />
  );
}
