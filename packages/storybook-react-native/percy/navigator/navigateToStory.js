import { uiTapNavigate } from './uiTapStrategy.js';
import { deepLinkNavigate } from './deepLinkStrategy.js';

/**
 * Single navigation entry point. UI-tap is the default strategy
 * (zero customer-side code/config). Deep-link is an opt-in alternative
 * for customers willing to register a URL scheme for sub-second navigation.
 *
 * @param {object} appiumDriver  AppiumDriver wrapper
 * @param {{ id: string, name: string, componentTitle: string }} descriptor
 * @param {object} opts
 *   - navigationStrategy: 'ui-tap' (default) | 'deeplink'
 *   - appScheme, appPackage: required when 'deeplink'
 *   - renderMs, coldBootMaxMs, globalNavigationBudgetMs, etc.
 */
export async function navigateToStory(appiumDriver, descriptor, opts = {}) {
  const strategy = opts.navigationStrategy ?? 'ui-tap';
  if (strategy === 'deeplink') {
    return deepLinkNavigate(appiumDriver, descriptor, opts);
  }
  return uiTapNavigate(appiumDriver, descriptor, opts);
}
