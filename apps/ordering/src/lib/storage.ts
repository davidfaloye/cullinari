import AsyncStorage from '@react-native-async-storage/async-storage';
import { TENANT } from './config';

const key = (name: string) => `cullinari.${TENANT.slug}.${name}`;

/** Small JSON store on the device. Failures are ignored: storage is a convenience only. */
export async function load<T>(name: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key(name));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function save(name: string, value: unknown) {
  try {
    await AsyncStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}
