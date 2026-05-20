import { Injectable, Logger } from '@nestjs/common';
import type { AiFixResult } from './fix-prompt.service';

export type ApplyResult =
  | { success: true; newContent: string; linesChanged: number }
  | { success: false; reason: 'source_mismatch' | 'line_out_of_range' | 'invalid_range'; detail: string };

@Injectable()
export class PatchApplicatorService {
  private readonly logger = new Logger(PatchApplicatorService.name);

  apply(fileContent: string, fix: AiFixResult): ApplyResult {
    const lines = fileContent.split('\n');
    const totalLines = lines.length;

    // Validate line range
    if (fix.startLine < 1 || fix.endLine < fix.startLine) {
      return {
        success: false,
        reason: 'invalid_range',
        detail: `Invalid range: startLine=${fix.startLine} endLine=${fix.endLine}`,
      };
    }

    if (fix.startLine > totalLines || fix.endLine > totalLines) {
      return {
        success: false,
        reason: 'line_out_of_range',
        detail: `Range ${fix.startLine}-${fix.endLine} exceeds file length ${totalLines}`,
      };
    }

    // Extract current content at the claimed range (0-indexed slice)
    const currentSlice = lines.slice(fix.startLine - 1, fix.endLine).join('\n');

    // Exact match check — this is the key safety invariant
    if (!this.codesMatch(currentSlice, fix.originalCode)) {
      this.logger.warn(
        `Source mismatch at ${fix.file}:${fix.startLine}-${fix.endLine}. ` +
        `Expected:\n${fix.originalCode}\nActual:\n${currentSlice}`,
      );
      return {
        success: false,
        reason: 'source_mismatch',
        detail: `originalCode does not match actual file content at lines ${fix.startLine}-${fix.endLine}. ` +
          `The source may have changed since the source map was generated.`,
      };
    }

    // Apply the fix — replace the range with fixedCode lines
    const fixLines = fix.fixedCode.split('\n');
    const before = lines.slice(0, fix.startLine - 1);
    const after = lines.slice(fix.endLine);
    const newContent = [...before, ...fixLines, ...after].join('\n');

    const originalLineCount = fix.endLine - fix.startLine + 1;
    const linesChanged = Math.abs(fixLines.length - originalLineCount) + originalLineCount;

    this.logger.log(
      `Patch applied to ${fix.file}: replaced lines ${fix.startLine}-${fix.endLine} ` +
      `(${originalLineCount} → ${fixLines.length} lines)`,
    );

    return { success: true, newContent, linesChanged };
  }

  private codesMatch(actual: string, expected: string): boolean {
    // Normalize line endings and trailing whitespace for comparison
    const normalize = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
    return normalize(actual) === normalize(expected);
  }
}
