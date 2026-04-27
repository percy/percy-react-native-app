import WebSocket from 'ws';
import { err } from './errors.js';

/**
 * @typedef {Object} StoryDescriptor
 * @property {string} id
 * @property {string} name
 * @property {string} componentTitle
 *
 * @typedef {Object} StorybookWSOptions
 * @property {string} host
 * @property {number} port
 * @property {number} [connectTimeoutMs]
 */

/**
 * Client for Storybook React Native's port-7007 WebSocket protocol.
 *
 * Wire format (Storybook's own — we don't invent it):
 *   { type: 'setCurrentStory', args: [{ storyId, viewMode: 'story' }] }
 *
 * The optional `@percy/storybook-react-native-addon` emits:
 *   { type: 'percy:ready', storyId }
 *
 * Without the addon, fall back to time-based wait via `waitForReadyMs`.
 */
export class StorybookWSClient {
  /**
   * @param {StorybookWSOptions} opts
   */
  constructor(opts) {
    this.opts = opts;
    /** @type {WebSocket | undefined} */
    this.ws = undefined;
    /** @type {Map<string, () => void>} */
    this.readyHandlers = new Map();
  }

  async connect() {
    const url = `ws://${this.opts.host}:${this.opts.port}`;
    const timeoutMs = this.opts.connectTimeoutMs ?? 5000;

    const ws = new WebSocket(url);
    this.ws = ws;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(
          err(
            'storybook_ws_unreachable',
            `Could not connect to Storybook RN WebSocket at ${url} within ${timeoutMs}ms.`,
            'Verify the app is running with Storybook in the foreground. For Android: `adb reverse tcp:7007 tcp:7007`.',
          ),
        );
      }, timeoutMs);

      ws.once('open', () => {
        clearTimeout(timer);
        resolve();
      });
      ws.once('error', (cause) => {
        clearTimeout(timer);
        reject(
          err(
            'storybook_ws_unreachable',
            `WebSocket error connecting to ${url}.`,
            'Verify the app is running with Storybook in the foreground.',
            cause,
          ),
        );
      });
    });

    ws.on('message', (raw) => this.handleMessage(raw.toString()));
  }

  /**
   * @param {string} raw
   */
  handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      // Storybook may send non-JSON keepalives; ignore.
      return;
    }
    if (msg && msg.type === 'percy:ready' && typeof msg.storyId === 'string') {
      const handler = this.readyHandlers.get(msg.storyId);
      if (handler) {
        handler();
        this.readyHandlers.delete(msg.storyId);
      }
    }
  }

  /**
   * Tells Storybook to render a story. Returns immediately.
   * Caller is responsible for waiting (via `awaitReady` or a timer).
   * @param {string} storyId
   */
  setCurrentStory(storyId) {
    this.send({ type: 'setCurrentStory', args: [{ storyId, viewMode: 'story' }] });
  }

  /**
   * Resolves when the optional Percy addon emits `percy:ready` for this story.
   * Rejects on timeout.
   * @param {string} storyId
   * @param {number} timeoutMs
   */
  async awaitReady(storyId, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyHandlers.delete(storyId);
        reject(
          err(
            'story_render_timeout',
            `Story "${storyId}" did not signal ready within ${timeoutMs}ms.`,
            'Install @percy/storybook-react-native-addon for deterministic ready signals, or increase storybook.waitForReadyMs.',
          ),
        );
      }, timeoutMs);

      this.readyHandlers.set(storyId, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * List stories currently registered in the running Storybook RN runtime.
   * Implementation note (Week 2): the exact request/response shape is TBD —
   * verify against `@storybook/react-native` v9 source. Falls back to
   * scanning `storybook.requires.js` if the WebSocket doesn't expose this.
   * @returns {Promise<StoryDescriptor[]>}
   */
  async listStories() {
    throw err(
      'no_stories_found',
      'Story enumeration via WebSocket not yet implemented (week-2 milestone).',
      'Provide stories explicitly via .percy.yml `include` for now, or wait for the next release.',
    );
  }

  /**
   * @param {unknown} msg
   */
  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw err('storybook_ws_unreachable', 'WebSocket is not open.');
    }
    this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws?.close();
    this.ws = undefined;
  }
}
