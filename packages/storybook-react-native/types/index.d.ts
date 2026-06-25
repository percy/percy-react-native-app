// Type declarations for @percy/storybook-react-native (library mode).
//
// Hand-written to mirror the JSDoc contracts in index.js. The CLI surface
// (`@percy/cli` command registration) is intentionally not typed here — it is
// consumed by the Percy CLI, not by TypeScript callers.

/** A story descriptor as returned by `discoverStories()`. */
export interface StoryDescriptor {
  /** Storybook story id, e.g. `"forms-button--primary"`. */
  id: string;
  /** Human story name, e.g. `"Primary"`. */
  name: string;
  /** Component title / group, e.g. `"Forms/Button"`. */
  componentTitle: string;
}

/** Options accepted by `discoverStories()`. */
export interface DiscoverStoriesOptions {
  /** Working directory to resolve the Storybook config from. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Storybook config directory. Defaults to `.rnstorybook`. */
  configDir?: string;
}

/** BrowserStack credentials, when not supplied via environment variables. */
export interface BrowserStackCredentials {
  userName?: string;
  accessKey?: string;
}

/** Options accepted by `provisionApp()`. */
export interface ProvisionAppOptions {
  /** Explicit transport. `"local"` forces no upload even when creds are present. */
  transport?: 'local' | 'app-automate';
  /** Build target (passed through from `buildAndProvision`). */
  target?: 'app-automate' | 'simulator' | 'emulator';
  /** BrowserStack credentials; falls back to BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY. */
  credentials?: BrowserStackCredentials;
  /** Skip the debuggable-build rejection check. */
  skipDebugBuildCheck?: boolean;
  uploadRetries?: number;
  uploadTimeoutMs?: number;
  postUploadSettleMs?: number;
  probeTimeoutMs?: number;
}

/** Options accepted by `buildAndProvision()`. */
export interface BuildAndProvisionOptions extends ProvisionAppOptions {
  /** Absolute path to the RN project root (directory containing package.json). */
  projectPath: string;
  platform: 'android' | 'ios';
  variant?: 'debug' | 'release';
  buildTimeoutMs?: number;
  skipBuildIfArtifactExists?: boolean;
}

/**
 * Flat snapshot option surface. Navigation-only keys are consumed by the SDK;
 * everything else is forwarded to `@percy/appium-app`'s `percyScreenshot`.
 * Kept permissive so the full percy-appium-js option set remains available.
 */
export interface PercyStorybookSnapshotOptions {
  navigationStrategy?: string;
  appScheme?: string;
  appPackage?: string;
  renderMs?: number;
  coldBootMaxMs?: number;
  globalNavigationBudgetMs?: number;
  testIdPollMaxMs?: number;
  stabilityPollMaxMs?: number;
  stabilityMaxAttempts?: number;
  stabilitySettleMs?: number;
  cacheNavigatorState?: boolean;
  freezeAnimatedImage?: boolean;
  fullPage?: boolean;
  sync?: boolean;
  testCase?: string;
  labels?: string[];
  [key: string]: unknown;
}

/**
 * Library-mode entry point. Navigates to `story` and captures a Percy
 * snapshot via `@percy/appium-app`. Returns the percyScreenshot result
 * (snapshot link / comparison body) when available.
 */
export default function percyStorybookSnapshot(
  driver: unknown,
  story: StoryDescriptor,
  options?: PercyStorybookSnapshotOptions,
): Promise<unknown>;

export function percyStorybookSnapshot(
  driver: unknown,
  story: StoryDescriptor,
  options?: PercyStorybookSnapshotOptions,
): Promise<unknown>;

/** Discover Storybook stories from the on-disk Storybook config. */
export function discoverStories(
  opts?: DiscoverStoriesOptions,
): Promise<StoryDescriptor[]>;

/**
 * Provision an app for an Appium session. Returns a `bs://` URL (App Automate)
 * or the absolute local path (local/simulator transport).
 */
export function provisionApp(
  localPath: string,
  opts?: ProvisionAppOptions,
): Promise<string>;

/** Validate and return a pre-provisioned `bs://` app reference. */
export function useAppReference(ref: unknown): string;

/**
 * Build the RN host app and provision it. Returns a `bs://` URL (App Automate)
 * or the absolute local artifact path (Simulator/local).
 */
export function buildAndProvision(opts: BuildAndProvisionOptions): Promise<string>;

/**
 * try/finally wrapper that guarantees `driver.deleteSession()` runs even when
 * the test body throws. Returns the test body's resolved value.
 */
export function runSession<T>(driver: unknown, fn: () => Promise<T>): Promise<T>;
