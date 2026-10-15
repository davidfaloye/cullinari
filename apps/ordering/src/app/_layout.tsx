import { useEffect } from 'react';
import { Platform } from 'react-native';
import { router, Stack } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TENANT } from '@/lib/config';
import { StoreProvider, useStore } from '@/lib/store';
import { base, useTheme } from '@/lib/theme';
import '@/lib/notifications';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Tapping an order-status notification opens that order's tracking screen. */
function useNotificationTaps() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const open = (data: unknown) => {
      const token = (data as { trackingToken?: string } | undefined)?.trackingToken;
      if (token) router.push({ pathname: '/order/[token]', params: { token } });
    };
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last.notification.request.content.data);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => sub.remove();
  }, []);
}

function Navigator() {
  const { ready, config } = useStore();
  const t = useTheme();
  useNotificationTaps();

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={t.onPrimary === '#ffffff' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.primary },
          headerTintColor: t.onPrimary,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: base.bg },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ title: config?.app?.name ?? config?.name ?? TENANT.appName }} />
        <Stack.Screen name="branch" options={{ title: 'Choose a branch', presentation: 'modal' }} />
        <Stack.Screen name="item/[id]" options={{ title: '', presentation: 'modal' }} />
        <Stack.Screen name="cart" options={{ title: 'Your order' }} />
        <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
        <Stack.Screen name="order/[token]" options={{ title: 'Order status' }} />
        <Stack.Screen name="orders" options={{ title: 'Your orders' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Navigator />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
