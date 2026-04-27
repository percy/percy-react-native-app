import { view } from './storybook.requires';

// In-memory storage shim — Expo Go lacks @react-native-async-storage/async-storage
// native module, but Storybook RN only uses storage for "remember last story"
// across app launches. An ephemeral in-memory storage works fine for visual testing.
const memStore: Record<string, string> = {};
const inMemoryStorage = {
  getItem: async (key: string) => (key in memStore ? memStore[key] : null),
  setItem: async (key: string, value: string) => {
    memStore[key] = value;
  },
};

const StorybookUIRoot = view.getStorybookUI({
  storage: inMemoryStorage,
  // Opt in to the WebSocket connection so external tools (Percy SDK, the
  // metro server) can drive setCurrentStory remotely. Defaults to false.
  enableWebsockets: true,
});

export default StorybookUIRoot;
