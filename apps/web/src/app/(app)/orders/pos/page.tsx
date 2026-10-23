import { OrderList } from '@/components/app/order-list';

export default function Page() {
  return (
    <OrderList
      title="POS orders"
      description="Orders taken in a shop. The store is recorded on the order, so sales stay attributable by branch."
      channel="POS"
    />
  );
}
