import { Injectable, Logger } from '@nestjs/common';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(__filename);

export type ValidationResult =
  | { ok: true; skipped?: boolean; reason?: string }
  | { ok: false; errors: string[] };

const SYNTAX_CHECKABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/**
 * Lightweight syntax validation of a patched file before a PR is opened.
 * Catches structurally broken AI patches (unbalanced braces, truncated code)
 * without the full Docker sandbox planned in AUTOFIX_ARCHITECTURE Phase 4.
 * Semantic/type errors across files are out of scope here — that's what the
 * sandbox (and the target repo's own CI) are for.
 */
@Injectable()
export class FixValidatorService {
  private readonly logger = new Logger(FixValidatorService.name);

  validate(filePath: string, content: string): ValidationResult {
    if (!SYNTAX_CHECKABLE.test(filePath)) {
      return { ok: true, skipped: true, reason: 'unsupported file type' };
    }

    let ts: typeof import('typescript');
    try {
      // Loaded lazily: typescript is a devDependency, so production installs
      // without dev deps skip validation instead of crashing the worker.
      ts = nodeRequire('typescript') as typeof import('typescript');
    } catch {
      this.logger.warn(
        'typescript module unavailable — skipping patched-file syntax validation',
      );
      return { ok: true, skipped: true, reason: 'typescript unavailable' };
    }

    const result = ts.transpileModule(content, {
      reportDiagnostics: true,
      fileName: filePath,
      compilerOptions: {
        jsx: ts.JsxEmit.Preserve,
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
      },
    });

    const diagnostics = (result.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    );
    if (diagnostics.length === 0) return { ok: true };

    const errors = diagnostics.slice(0, 5).map((d) => {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      if (d.file && d.start !== undefined) {
        const pos = d.file.getLineAndCharacterOfPosition(d.start);
        return `${filePath}:${pos.line + 1}:${pos.character + 1} ${msg}`;
      }
      return msg;
    });
    return { ok: false, errors };
  }
}
