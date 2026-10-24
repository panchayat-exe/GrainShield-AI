/**
 * Jest Global Setup for React Native / Expo
 */

// Global mock for AsyncStorage (prefixed with `mock` so Babel permits out-of-scope access)
const mockAsyncStorageStore = new Map();

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(async (key, value) => {
    mockAsyncStorageStore.set(key, value);
    return null;
  }),
  getItem: jest.fn(async (key) => {
    return mockAsyncStorageStore.get(key) ?? null;
  }),
  removeItem: jest.fn(async (key) => {
    mockAsyncStorageStore.delete(key);
    return null;
  }),
  clear: jest.fn(async () => {
    mockAsyncStorageStore.clear();
    return null;
  }),
  getAllKeys: jest.fn(async () => Array.from(mockAsyncStorageStore.keys())),
}));

// Global mock for Expo FileSystem
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///data/user/0/grainshield/files/',
  readAsStringAsync: jest.fn().mockResolvedValue('base64data'),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  copyAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, isDirectory: true }),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

// Global mock for Expo SecureStore
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(null),
  deleteItemAsync: jest.fn().mockResolvedValue(null),
}));
