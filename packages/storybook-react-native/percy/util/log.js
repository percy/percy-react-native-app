import logger from '@percy/logger';

/**
 * Library-mode log namespace. Mirrors @percy/percy-appium-js shape so log
 * lines are consistent across the Percy mobile-SDK family.
 *
 * Usage:
 *   import { log } from './util/log.js';
 *   log.info('something happened');
 *   log.warn('non-fatal', { context });
 */
export const log = logger('storybook-rn');
