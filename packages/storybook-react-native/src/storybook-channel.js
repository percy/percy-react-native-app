import { err } from './errors.js';

/**
 * @typedef {Object} ChannelOptions
 * @property {string} host
 * @property {number} port
 *
 * @typedef {Object} SelectResult
 * @property {boolean} success
 * @property {string} storyId
 * @property {string} [error]
 */

/**
 * HTTP client for Storybook RN's metro channel server (port 7007 by default).
 *
 * The channel server exposes:
 *   POST /select-story-sync/<storyId>  — select a story AND wait for render
 *                                        confirmation from the connected device.
 *                                        Returns 200 on rendered, 408 on timeout,
 *                                        503 if WebSockets disabled.
 *
 * This endpoint does the WebSocket dance internally (broadcast setCurrentStory
 * to all connected clients, wait for the rendered-story ack from any client),
 * so the SDK doesn't need to manage a long-lived WebSocket itself.
 */
export class StorybookChannelClient {
  /**
   * @param {ChannelOptions} opts
   */
  constructor(opts) {
    this.opts = opts;
  }

  /**
   * @returns {string} Base URL like "http://localhost:7007"
   */
  baseUrl() {
    return `http://${this.opts.host}:${this.opts.port}`;
  }

  /**
   * Quick reachability probe — used by `doctor` and runner preflight.
   * Pings the WS endpoint URL with a short timeout. The channel server
   * responds 404 to GET / which is enough to confirm the listener is up.
   * @returns {Promise<void>}  Throws on unreachable.
   */
  async probe() {
    const url = `${this.baseUrl()}/percy-probe-${Date.now()}`;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      await fetch(url, { method: 'GET', signal: ctl.signal });
      clearTimeout(timer);
    } catch (cause) {
      throw err(
        'storybook_ws_unreachable',
        `Storybook channel server not reachable at ${this.baseUrl()}.`,
        'Verify the Metro dev server is running with the withStorybook({ websockets: { host, port } }) wrapper from `storybook-rn:init` (see SETUP.md §4).',
        cause,
      );
    }
  }

  /**
   * Selects a story and waits for the device to confirm it rendered.
   * Resolves on 200 (rendered). Throws on timeout (408) or other errors.
   *
   * @param {string} storyId
   * @param {number} timeoutMs   request timeout in ms
   * @returns {Promise<void>}
   */
  async selectAndAwaitRender(storyId, timeoutMs) {
    const url = `${this.baseUrl()}/select-story-sync/${encodeURIComponent(storyId)}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs + 2000); // server has its own timeout; we add headroom

    let res;
    try {
      res = await fetch(url, { method: 'POST', signal: ctl.signal });
    } catch (cause) {
      clearTimeout(timer);
      throw err(
        'story_render_timeout',
        `Network error selecting story "${storyId}".`,
        'Check that Metro dev server is running and the simulator is connected.',
        cause,
      );
    }
    clearTimeout(timer);

    if (res.status === 200) return;

    let body;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (res.status === 408) {
      throw err(
        'story_render_timeout',
        `Story "${storyId}" did not render within timeout.`,
        'Confirm the device app is running and connected to Metro. Increase storybook.waitForReadyMs if rendering is slow.',
      );
    }
    if (res.status === 503) {
      throw err(
        'storybook_ws_unreachable',
        `Channel server is up but WebSockets disabled (no devices to drive).`,
        'Add `enableWebsockets: true` to your getStorybookUI() options in .rnstorybook/index (see SETUP.md §4).',
      );
    }
    throw err(
      'story_render_timeout',
      `Unexpected response ${res.status} selecting "${storyId}": ${body.error ?? 'unknown'}.`,
    );
  }
}
