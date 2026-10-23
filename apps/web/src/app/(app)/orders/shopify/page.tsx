import { OrderList } from '@/components/app/order-list';

export default function Page() {
  return (
    <OrderList
      title="Shopify orders"
      description="Orders placed online. Demand is driven by what is still owed to the customer, not by what was originally ordered."
      channel="ONLINE"
    />
  );
}
