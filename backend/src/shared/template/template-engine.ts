/**
 * Safe template engine — regex only, no eval/Function.
 *
 * Supports two namespaces:
 *   {{var.X}}  → from integration config variables (non-secret)
 *   {{bug.X}}  → from runtime bug payload
 */

const TEMPLATE_REGEX = /\{\{\s*(var|bug)\.([a-zA-Z_]\w*)\s*\}\}/g;

export function renderTemplate(
  template: string,
  varCtx: Record<string, string>,
  bugCtx: Record<string, string>,
): string {
  return template.replace(TEMPLATE_REGEX, (_match, namespace: string, key: string) => {
    const source = namespace === 'var' ? varCtx : bugCtx;
    return source[key] ?? '';
  });
}

export function renderJsonTemplate(
  template: unknown,
  varCtx: Record<string, string>,
  bugCtx: Record<string, string>,
): unknown {
  return cloneAndSubstitute(template, varCtx, bugCtx);
}

function cloneAndSubstitute(
  value: unknown,
  varCtx: Record<string, string>,
  bugCtx: Record<string, string>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(TEMPLATE_REGEX, (_match, namespace: string, key: string) => {
      const source = namespace === 'var' ? varCtx : bugCtx;
      return source[key] ?? '';
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneAndSubstitute(item, varCtx, bugCtx));
  }

  if (value !== null && typeof value === 'object') {
    const cloned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      cloned[k] = cloneAndSubstitute(v, varCtx, bugCtx);
    }
    return cloned;
  }

  // number, boolean, null — preserve as-is
  return value;
}

/**
 * Dot-notation + bracket-index path extractor.
 * Supports: "data.id", "data.items[0].id"
 * Returns undefined if any segment is missing.
 */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return undefined;

  // Tokenize: split on dots, but keep bracket contents together
  const tokens: string[] = [];
  const regex = /\[([^\]]+)\]|\.?([^.\[]+)/g;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(path)) !== null) {
    const bracket = m[1];
    const plain = m[2];
    if (bracket !== undefined) {
      tokens.push(bracket);
    } else if (plain !== undefined) {
      tokens.push(plain);
    }
  }

  let current: unknown = obj;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = parseInt(token, 10);
      if (Number.isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }

  return current;
}
