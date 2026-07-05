import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@chromeamp/anon_user_id';

let cached: string | null = null;

function genId(): string {
  // RFC4122 v4-ish
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getAnonUserId(): Promise<string> {
  if (cached) return cached;
  let id = await AsyncStorage.getItem(KEY);
  if (!id) {
    id = genId();
    await AsyncStorage.setItem(KEY, id);
  }
  cached = id;
  return id;
}

export function getAnonUserIdSync(): string | null {
  return cached;
}
