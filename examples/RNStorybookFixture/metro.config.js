// Metro config wrapping Expo's default + Storybook RN's WebSocket server.
// withStorybook hosts the WS server (port 7007) on the Metro dev server.
// Devices and the @percy/storybook-react-native SDK both connect to it.

const { getDefaultConfig } = require('expo/metro-config');
const { withStorybook } = require('@storybook/react-native/metro/withStorybook');

const config = getDefaultConfig(__dirname);

module.exports = withStorybook(config, {
  configPath: './.rnstorybook',
  websockets: 'auto',  // enables WS + HTTP server on port 7007
});
