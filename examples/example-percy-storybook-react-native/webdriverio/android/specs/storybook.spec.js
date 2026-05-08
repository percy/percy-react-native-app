// Sample customer test — copy and adapt to your project.
//
// Iterates every story discovered by reading the customer project's
// .rnstorybook/main.{ts,js} + .stories.* files, navigates to each via
// Storybook RN's in-app navigator drawer (UI-tap), and captures a Percy
// snapshot per story.
//
// Run with:
//   PERCY_TOKEN=... BROWSERSTACK_USERNAME=... BROWSERSTACK_ACCESS_KEY=... \
//   PERCY_APP_URL=bs://... \
//   PERCY_RN_PROJECT_DIR=/path/to/your/rn/app \
//   npx percy app:exec -- npm run android

import percyStorybookSnapshot, {
  discoverStories,
} from '@percy/storybook-react-native';

describe('Percy Storybook RN — App Automate smoke', () => {
  it('captures a Percy snapshot for every story', async () => {
    // Discover stories from the customer's RN project (configurable via env).
    const stories = await discoverStories({
      cwd: process.env.PERCY_RN_PROJECT_DIR || process.cwd(),
    });

    if (stories.length === 0) {
      throw new Error(
        'No stories discovered. Set PERCY_RN_PROJECT_DIR to your RN app root, ' +
          'or place .rnstorybook/main.ts at the cwd.',
      );
    }

    // Sort by componentTitle to maximize navigator-cache hits when enabled.
    stories.sort((a, b) =>
      a.componentTitle.localeCompare(b.componentTitle) || a.name.localeCompare(b.name),
    );

    for (const story of stories) {
      // The customer's wdio config exposes `driver` (or `browser`) globally.
      // We pass it explicitly for clarity.
      // eslint-disable-next-line no-undef
      await percyStorybookSnapshot(driver, story);
    }
  });
});
