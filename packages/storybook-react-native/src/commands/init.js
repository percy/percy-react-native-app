import command from '@percy/cli-command';
import fs from 'node:fs/promises';
import path from 'node:path';

const PERCY_YML_TEMPLATE = `version: 2
storybook-rn:
  appium:
    server: http://localhost:4723
    capabilities:
      platformName: iOS
      "appium:platformVersion": "17.0"
      "appium:deviceName": "iPhone 15"
      "appium:bundleId": "com.yourcompany.yourapp"
      "appium:automationName": XCUITest
  storybook:
    websocketPort: 7007
    waitForReadyMs: 1000
  include:
    - "**/*"
  skip: []
`;

const ADDON_SNIPPET = `
// In your .storybook/preview.js (or preview.tsx):
import { withPercyReady } from '@percy/storybook-react-native-addon';

export const decorators = [withPercyReady];
`;

const SAMPLE_STORY = `import React from 'react';
import { Pressable, Text } from 'react-native';

export default { title: 'Button', component: Pressable };

export const Primary = () => (
  <Pressable style={{ padding: 12, backgroundColor: '#0070f3', borderRadius: 6 }}>
    <Text style={{ color: 'white', fontWeight: '600' }}>Primary</Text>
  </Pressable>
);

export const Disabled = () => (
  <Pressable style={{ padding: 12, backgroundColor: '#cbd5e1', borderRadius: 6 }} disabled>
    <Text style={{ color: '#64748b', fontWeight: '600' }}>Disabled</Text>
  </Pressable>
);
`;

/**
 * `npx @percy/storybook-react-native init`
 *
 * Scaffolds:
 *   - .percy.yml (with storybook-rn config block)
 *   - prints copy-paste snippet for the optional Percy addon
 *   - drops a sample Button.stories.tsx if the project has no stories
 */
export default command('init', {
  description: 'Scaffold .percy.yml and print next steps for Storybook RN integration.',
}, async ({ log }) => {
  const cwd = process.cwd();
  const percyYmlPath = path.join(cwd, '.percy.yml');

  try {
    await fs.access(percyYmlPath);
    log.warn(`.percy.yml already exists at ${percyYmlPath} — skipping.`);
  } catch {
    await fs.writeFile(percyYmlPath, PERCY_YML_TEMPLATE, 'utf8');
    log.info(`✓ Wrote ${percyYmlPath}`);
  }

  const sampleDir = path.join(cwd, 'stories');
  const samplePath = path.join(sampleDir, 'Button.stories.tsx');
  try {
    await fs.access(samplePath);
  } catch {
    try {
      await fs.mkdir(sampleDir, { recursive: true });
      await fs.writeFile(samplePath, SAMPLE_STORY, 'utf8');
      log.info(`✓ Wrote sample story at ${samplePath}`);
    } catch (e) {
      log.warn(`Could not write sample story: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log.info('');
  log.info('Next steps:');
  log.info('  1. Edit .percy.yml — set the bundleId and platform version for your app.');
  log.info('  2. (Optional) install @percy/storybook-react-native-addon and add the decorator:');
  log.info(ADDON_SNIPPET);
  log.info('  3. Boot your simulator and Appium, then run: percy storybook-rn doctor');
  log.info('  4. When doctor passes: percy exec -- percy storybook-rn');
});
