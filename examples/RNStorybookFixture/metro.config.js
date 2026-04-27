// Metro config wrapping Expo's default + Storybook RN's WebSocket server.
// withStorybook hosts the WS server (port 7007) on the Metro dev server.
// Devices and the @percy/storybook-react-native SDK both connect to it.

const { getDefaultConfig } = require('expo/metro-config');
const { withStorybook } = require('@storybook/react-native/metro/withStorybook');

const config = getDefaultConfig(__dirname);

module.exports = withStorybook(config, {
  configPath: './.rnstorybook',
  // Bind explicitly so the device connects to the same host the channel server listens on.
  // iOS Simulator shares the host's loopback interface — localhost works for both directions.
  websockets: { host: '127.0.0.1', port: 7007 },
});
