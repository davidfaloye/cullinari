import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Landing route for the Paystack return link (scheme://payment?token=...). Usually the in-app
 * browser closes before this is reached; if the system opens the link instead, go to the order.
 */
export default function PaymentReturn() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return token ? <Redirect href={{ pathname: '/order/[token]', params: { token } }} /> : <Redirect href="/" />;
}
