import type { StorybookConfig } from '@storybook/react-native';

// On-device addons (controls, actions) require native modules unavailable in
// Expo Go. They're omitted here so the fixture runs with `expo start --ios`.
// Story rendering itself does not depend on them — Percy drives navigation
// externally via Metro's port-7007 channel server.
const main: StorybookConfig = {
  stories: ['./stories/**/*.stories.?(ts|tsx|js|jsx)'],
  addons: [],
};

export default main;
