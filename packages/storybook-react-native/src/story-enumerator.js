import fs from 'node:fs/promises';
import path from 'node:path';
import { err } from './errors.js';

/**
 * @typedef {import('./runner.js').StoryDescriptor} StoryDescriptor
 *
 * Auto-enumerates Storybook RN stories by reading the customer's
 * `.rnstorybook/main.{ts,js}` config and parsing the `.stories.{ts,tsx,js,jsx}`
 * files referenced by the `stories` glob.
 *
 * This avoids needing the on-device runtime to be reachable for enumeration —
 * the SDK can list stories from the project's source files alone, then drive
 * the device via the metro channel server's HTTP /select-story-sync endpoint.
 *
 * Supports the default Storybook RN scaffolding produced by
 * `npx storybook init --type react_native`. Customers with custom config
 * shapes can override via `--stories` or `storybook-rn.stories` in .percy.yml.
 */

const DEFAULT_CONFIG_DIR = '.rnstorybook';
const DEFAULT_STORIES_GLOB = './stories/**/*.stories.?(ts|tsx|js|jsx)';

/**
 * @param {string} cwd  customer's project root (typically process.cwd())
 * @param {string} [configDir]  override for `.rnstorybook` location
 * @returns {Promise<StoryDescriptor[]>}
 */
export async function enumerateStories(cwd, configDir = DEFAULT_CONFIG_DIR) {
  const absConfigDir = path.resolve(cwd, configDir);
  const exists = await pathExists(absConfigDir);
  if (!exists) {
    throw err(
      'no_stories_found',
      `Storybook config dir not found at ${absConfigDir}.`,
      'Run `npx storybook init --type react_native` to scaffold one, or pass --stories explicitly.',
    );
  }

  // 1. Find the stories glob from main.{ts,js}.
  const storiesGlobs = await readStoriesGlobs(absConfigDir);

  // 2. Resolve each glob to actual .stories files.
  const storyFiles = await resolveStoryFiles(absConfigDir, storiesGlobs);
  if (storyFiles.length === 0) {
    throw err(
      'no_stories_found',
      `Storybook config found at ${absConfigDir} but no .stories files matched ${storiesGlobs.join(', ')}.`,
      'Check that your stories live under the configured glob, or pass --stories.',
    );
  }

  // 3. Parse each file for title + named exports → StoryDescriptor[].
  const descriptors = [];
  for (const file of storyFiles) {
    const parsed = await parseStoryFile(file);
    descriptors.push(...parsed);
  }
  if (descriptors.length === 0) {
    throw err(
      'no_stories_found',
      `Found ${storyFiles.length} .stories file(s) but no exported stories within them.`,
      'CSF format requires `export default { title: ... }` plus named exports.',
    );
  }
  return descriptors;
}

/**
 * Reads `.rnstorybook/main.{ts,js}` and extracts the stories glob array.
 * Falls back to the default if the file exists but the field can't be parsed.
 *
 * @param {string} absConfigDir
 * @returns {Promise<string[]>}
 */
async function readStoriesGlobs(absConfigDir) {
  for (const ext of ['ts', 'tsx', 'js', 'mjs', 'cjs']) {
    const file = path.join(absConfigDir, `main.${ext}`);
    if (await pathExists(file)) {
      const src = await fs.readFile(file, 'utf8');
      const globs = extractStoriesField(src);
      if (globs.length > 0) return globs;
    }
  }
  return [DEFAULT_STORIES_GLOB];
}

/**
 * Regex-extract the `stories: [...]` array from a Storybook main config.
 * Handles single quotes, double quotes, multi-line. Brittle to exotic shapes
 * (computed values, spread). For the common scaffold output it's reliable.
 *
 * @param {string} src
 */
export function extractStoriesField(src) {
  // strip line + block comments to avoid false matches inside docs.
  // Block-comment regex uses `+?` (not `*?`) so it does NOT eat `/**/` —
  // a glob's `**` is the substring `/**/` which the lazy `*?` form would
  // happily consume as a zero-content comment.
  const stripped = src
    .replace(/\/\*[\s\S]+?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const match = stripped.match(/stories\s*:\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  const inner = match[1];
  const globs = [];
  for (const m of inner.matchAll(/['"`]([^'"`]+)['"`]/g)) {
    globs.push(m[1]);
  }
  return globs;
}

/**
 * Resolves the storybook glob array against the configDir.
 * The Storybook RN convention is globs relative to the config dir.
 *
 * Implements `**` (recursive) and `*` (single-segment, non-slash) and
 * `?(...)` extension alternation — the patterns Storybook ships in main.ts.
 * Uses node:fs walking so we don't pull a glob lib as a runtime dep.
 *
 * @param {string} absConfigDir
 * @param {string[]} globs
 */
async function resolveStoryFiles(absConfigDir, globs) {
  const files = new Set();
  for (const g of globs) {
    const matched = await walkGlob(absConfigDir, g);
    for (const f of matched) files.add(f);
  }
  return [...files].sort();
}

/**
 * @param {string} root
 * @param {string} glob
 */
async function walkGlob(root, glob) {
  // Normalize leading "./" — Storybook scaffolds with "./stories/..."
  let pattern = glob.replace(/^\.\//, '');
  // ?(ts|tsx|js|jsx) → group of allowed extensions
  /** @type {string[]} */
  let exts = [];
  pattern = pattern.replace(/\.\?\(([^)]+)\)$/, (_m, alts) => {
    exts = alts.split('|').map((s) => s.trim());
    return '';
  });
  // Now pattern looks like: stories/**/*.stories
  const segments = pattern.split('/');
  const allFiles = await walkDir(root);
  return allFiles.filter((file) => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    return matchesSegments(rel, segments, exts);
  });
}

/**
 * Recursively list every file under root.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function walkDir(root) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  async function recurse(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules') continue;
        await recurse(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  }
  await recurse(root);
  return out;
}

/**
 * @param {string} rel        path/to/file.ext
 * @param {string[]} segments glob segments (e.g. ['stories', '**', '*.stories'])
 * @param {string[]} exts     allowed extensions (e.g. ['ts','tsx','js','jsx'])
 */
function matchesSegments(rel, segments, exts) {
  // Match extension first
  if (exts.length > 0) {
    const okExt = exts.some((e) => rel.endsWith(`.${e}`));
    if (!okExt) return false;
    // Strip the matched extension for the rest of the comparison
    rel = rel.replace(/\.[^.]+$/, '');
  }
  const parts = rel.split('/');
  return matchSegList(parts, segments);
}

/**
 * @param {string[]} parts
 * @param {string[]} segs
 */
function matchSegList(parts, segs) {
  if (segs.length === 0) return parts.length === 0;
  const [head, ...rest] = segs;
  if (head === '**') {
    // ** matches zero or more segments
    for (let i = 0; i <= parts.length; i++) {
      if (matchSegList(parts.slice(i), rest)) return true;
    }
    return false;
  }
  if (parts.length === 0) return false;
  const [phead, ...prest] = parts;
  if (segWildcardMatch(head, phead)) return matchSegList(prest, rest);
  return false;
}

/**
 * Single-segment wildcard match. Supports `*` (zero-or-more non-slash chars).
 * @param {string} pattern
 * @param {string} input
 */
function segWildcardMatch(pattern, input) {
  if (!pattern.includes('*')) return pattern === input;
  const re = new RegExp(
    '^' +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*') +
      '$',
  );
  return re.test(input);
}

/**
 * Parses one .stories file for `default export title` and named exports →
 * StoryDescriptor[].
 *
 * Handles the CSF v3 shape (object literal default export with `title` field)
 * and `satisfies Meta<...>` annotation common in TS files.
 *
 * @param {string} file
 * @returns {Promise<StoryDescriptor[]>}
 */
async function parseStoryFile(file) {
  const src = await fs.readFile(file, 'utf8');

  // Phase 2.1 — prefer the AST parser. It handles spread operators, computed
  // titles, indirect meta references via const bindings, and `satisfies Meta<…>`
  // patterns the regex parser silently misses. Falls back to the legacy regex
  // parser if AST parsing returns nothing (e.g., a file with custom CSF shape
  // the AST walker doesn't recognize yet).
  try {
    const { parseStoriesAst } = await import('../percy/util/storyParser.js');
    const astStories = parseStoriesAst(src, file);
    if (astStories.length > 0) return astStories;
  } catch {
    // AST parser failed (missing peer dep, etc.). Fall through to regex.
  }

  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  const title = extractTitle(stripped);
  if (!title) return [];

  const componentTitle = title.replace(/\//g, '/');
  const titleId = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  /** @type {StoryDescriptor[]} */
  const stories = [];
  const seen = new Set();
  for (const m of stripped.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*[:=]/g)) {
    const exportName = m[1];
    if (seen.has(exportName)) continue;
    seen.add(exportName);
    if (exportName === 'default') continue;

    const id = `${titleId}--${kebab(exportName)}`;
    stories.push({
      id,
      name: humanize(exportName),
      componentTitle,
    });
  }
  return stories;
}

/**
 * Extracts `title: 'Foo/Bar'` from the default export's meta object.
 * Supports both `export default { title: 'X', ... }` and the
 * `const meta = { title: 'X' } satisfies Meta` pattern.
 *
 * @param {string} src
 */
export function extractTitle(src) {
  // Direct: export default { ..., title: '...', ... }
  const direct = src.match(/export\s+default\s*\{[\s\S]*?\btitle\s*:\s*['"`]([^'"`]+)['"`]/);
  if (direct) return direct[1];
  // Indirect: const meta = { ..., title: '...', ... } satisfies Meta
  //           export default meta;
  const m = src.match(/(?:const|let|var)\s+(\w+)\s*=\s*\{[\s\S]*?\btitle\s*:\s*['"`]([^'"`]+)['"`]/);
  if (m) {
    const ident = m[1];
    if (new RegExp(`export\\s+default\\s+${ident}\\b`).test(src)) {
      return m[2];
    }
  }
  return null;
}

/**
 * @param {string} s
 */
function kebab(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * @param {string} s
 */
function humanize(s) {
  // Split camelCase / PascalCase → "Logged In", "With Image"
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

/**
 * @param {string} p
 * @returns {Promise<boolean>}
 */
async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
