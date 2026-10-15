import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { EAS_PROJECT_ID } from './config';

// Show order updates even while the app is open.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Asks for notification permission (at checkout, when the reason is obvious) and returns the
 * Expo push token the API uses to send order-status updates. Returns undefined on web,
 * simulators, without an EAS project, or if the customer says no; ordering still works.
 */
export async function registerForOrderUpdates(): Promise<string | undefined> {
  if (Platform.OS === 'web' || !Device.isDevice || !EAS_PROJECT_ID) return undefined;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return undefined;
    const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    return token.data;
  } catch {
    return undefined;
  }
}
