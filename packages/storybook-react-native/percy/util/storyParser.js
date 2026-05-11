import { parse } from '@babel/parser';

/**
 * AST-based parser for Storybook CSF (Component Story Format) files.
 * Replaces the regex parser in src/story-enumerator.js for files where
 * regex falls short — spread operators, computed titles, indirect meta
 * references, `satisfies Meta<…>` annotations.
 *
 * Approach: parse with @babel/parser (ESM + TypeScript + JSX), then walk
 * the AST manually (no @babel/traverse — keeps deps light, and our
 * traversal is shallow).
 *
 * Returns an array of `{ id, name, componentTitle }` descriptors matching
 * the shape produced by the legacy regex parser.
 */

/**
 * @typedef {{ id: string, name: string, componentTitle: string }} StoryDescriptor
 */

/**
 * @param {string} src    Raw source of a .stories.{ts,tsx,js,jsx} file
 * @param {string} [filename] Optional — improves parser error messages
 * @returns {StoryDescriptor[]}
 */
export function parseStoriesAst(src, filename = 'stories.tsx') {
  let ast;
  try {
    ast = parse(src, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      sourceFilename: filename,
      errorRecovery: true,
    });
  } catch {
    return [];
  }

  // Index top-level `const NAME = expression` for indirect meta lookup.
  const constBindings = collectConstBindings(ast);

  // Find default export and extract `title`.
  const defaultMeta = findDefaultExportObject(ast, constBindings);
  if (!defaultMeta) return [];

  const title = resolveStringProperty(defaultMeta, 'title', constBindings);
  if (!title) return [];

  // Compute the title ID the same way the legacy regex parser does, so
  // descriptors are byte-identical between parsers. PoC empirically confirmed
  // Storybook RN's URL handler accepts this kebab-with-hyphens form.
  const titleId = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Find named story exports (`export const Primary = …`).
  const storyExports = findNamedExports(ast);
  return storyExports.map((name) => ({
    id: `${titleId}--${kebab(name)}`,
    name: humanize(name),
    componentTitle: title,
  }));
}

/**
 * camelCase / PascalCase → kebab-case. Mirrors src/story-enumerator.js's
 * kebab() so AST and regex parsers produce identical IDs.
 */
function kebab(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Walk the top-level program body for `const NAME = …` bindings.
 * Returns a map of name → Expression node.
 */
function collectConstBindings(ast) {
  const map = new Map();
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    for (const decl of stmt.declarations) {
      if (decl.id?.type === 'Identifier' && decl.init) {
        map.set(decl.id.name, decl.init);
      }
    }
    // Also handle `export const NAME = …`
    if (
      stmt.type === 'ExportNamedDeclaration' &&
      stmt.declaration?.type === 'VariableDeclaration'
    ) {
      for (const decl of stmt.declaration.declarations) {
        if (decl.id?.type === 'Identifier' && decl.init) {
          map.set(decl.id.name, decl.init);
        }
      }
    }
  }
  return map;
}

/**
 * Find the object expression for `export default …`. Handles:
 *  - `export default { title: '…', component: … }`           — direct object
 *  - `export default meta;` + `const meta = { … }`           — indirect via const
 *  - `export default {} satisfies Meta<…>`                   — TS satisfies
 *
 * Returns the ObjectExpression node, or null if not found.
 */
function findDefaultExportObject(ast, constBindings) {
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ExportDefaultDeclaration') continue;
    let expr = stmt.declaration;
    // Unwrap `… satisfies Meta<…>`
    if (expr?.type === 'TSSatisfiesExpression') expr = expr.expression;
    // Unwrap `… as Meta<…>`
    if (expr?.type === 'TSAsExpression') expr = expr.expression;
    if (expr?.type === 'ObjectExpression') return expr;
    if (expr?.type === 'Identifier') {
      let bound = constBindings.get(expr.name);
      // Unwrap satisfies / as in the binding too
      if (bound?.type === 'TSSatisfiesExpression') bound = bound.expression;
      if (bound?.type === 'TSAsExpression') bound = bound.expression;
      if (bound?.type === 'ObjectExpression') return bound;
    }
  }
  return null;
}

/**
 * Find all `export const NAME = …` story-leaf exports.
 * Excludes the meta export (already handled separately) and any export
 * whose name starts with `__` (Storybook convention for internal).
 */
function findNamedExports(ast) {
  const names = [];
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ExportNamedDeclaration') continue;
    if (stmt.declaration?.type !== 'VariableDeclaration') continue;
    for (const decl of stmt.declaration.declarations) {
      if (decl.id?.type !== 'Identifier') continue;
      const name = decl.id.name;
      if (name.startsWith('__') || name === 'default' || name === 'meta') continue;
      names.push(name);
    }
  }
  return names;
}

/**
 * Resolve `propertyName` from an ObjectExpression, returning the string
 * literal value if found. Handles:
 *   - Direct string literal: `title: 'Forms/Button'`
 *   - Spread expansion: `{ ...base, title: '…' }` (visits the spread
 *     source object if it's an in-scope const)
 *   - Property identifier reference: `{ title: TITLE_CONST }`
 *
 * Returns null if the property isn't a resolvable string.
 */
function resolveStringProperty(objectExpr, propertyName, constBindings) {
  // Pass 1 — direct match
  for (const prop of objectExpr.properties) {
    if (prop.type === 'ObjectProperty' && propertyKey(prop) === propertyName) {
      const v = prop.value;
      if (v.type === 'StringLiteral') return v.value;
      if (v.type === 'Identifier') {
        const bound = constBindings.get(v.name);
        if (bound?.type === 'StringLiteral') return bound.value;
      }
    }
  }
  // Pass 2 — recurse into spreads (`...base`)
  for (const prop of objectExpr.properties) {
    if (prop.type !== 'SpreadElement') continue;
    if (prop.argument.type === 'Identifier') {
      const bound = constBindings.get(prop.argument.name);
      if (bound?.type === 'ObjectExpression') {
        const inner = resolveStringProperty(bound, propertyName, constBindings);
        if (inner) return inner;
      }
    }
    if (prop.argument.type === 'ObjectExpression') {
      const inner = resolveStringProperty(prop.argument, propertyName, constBindings);
      if (inner) return inner;
    }
  }
  return null;
}

function propertyKey(prop) {
  if (prop.key.type === 'Identifier') return prop.key.name;
  if (prop.key.type === 'StringLiteral') return prop.key.value;
  return null;
}

/**
 * 'WithImage' → 'With Image' — same humanization the regex parser uses
 * so descriptors look identical between parsers.
 */
function humanize(s) {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

export const __forTesting = { resolveStringProperty, collectConstBindings };
