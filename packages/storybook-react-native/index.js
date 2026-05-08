// Top-level library-mode entry point.
//
// Mirrors @percy/percy-appium-js's index.js shape: primary function as the
// default export, helpers as named exports. Customers can do either:
//
//   import percyStorybookSnapshot from '@percy/storybook-react-native';
//   import { discoverStories, provisionApp, useAppReference, runSession } from '@percy/storybook-react-native';
//
// CLI mode (existing PER-7859 surface) is unchanged — it still loads via
// the package's @percy/cli command registration in package.json. This
// library-mode entry is purely additive.
import percyStorybookSnapshot from './percy/percyStorybookSnapshot.js';
import { discoverStories } from './percy/discoverStories.js';
import { provisionApp, useAppReference } from './percy/provisionApp.js';
import { buildAndProvision } from './percy/buildAndProvision.js';
import { runSession } from './percy/util/runSession.js';

export default percyStorybookSnapshot;
export {
  percyStorybookSnapshot,
  discoverStories,
  provisionApp,
  useAppReference,
  buildAndProvision,
  runSession,
};
