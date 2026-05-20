import { Test } from '@nestjs/testing';
import { PatchApplicatorService } from './patch-applicator.service';
import type { AiFixResult } from './fix-prompt.service';

const makeFix = (overrides: Partial<AiFixResult> = {}): AiFixResult => ({
  file: 'src/app.ts',
  startLine: 2,
  endLine: 2,
  originalCode: 'const x = null;',
  fixedCode: 'const x = 0;',
  explanation: 'Replace null with 0',
  confidence: 0.9,
  requiresMultipleFiles: false,
  ...overrides,
});

describe('PatchApplicatorService', () => {
  let service: PatchApplicatorService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [PatchApplicatorService] }).compile();
    service = module.get(PatchApplicatorService);
  });

  const content = ['line1', 'const x = null;', 'line3'].join('\n');

  it('applies a valid patch', () => {
    const result = service.apply(content, makeFix());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newContent).toBe(['line1', 'const x = 0;', 'line3'].join('\n'));
      expect(result.linesChanged).toBeGreaterThan(0);
    }
  });

  it('returns source_mismatch when originalCode does not match', () => {
    const result = service.apply(content, makeFix({ originalCode: 'something else' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('source_mismatch');
  });

  it('returns line_out_of_range when range exceeds file length', () => {
    const result = service.apply(content, makeFix({ startLine: 1, endLine: 999 }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('line_out_of_range');
  });

  it('returns invalid_range when startLine > endLine', () => {
    const result = service.apply(content, makeFix({ startLine: 3, endLine: 1 }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('invalid_range');
  });

  it('returns invalid_range when startLine is 0', () => {
    const result = service.apply(content, makeFix({ startLine: 0, endLine: 1 }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('invalid_range');
  });

  it('normalises CRLF line endings when comparing', () => {
    const crlfContent = ['line1', 'const x = null;\r', 'line3'].join('\n');
    const result = service.apply(crlfContent, makeFix({ originalCode: 'const x = null;' }));
    expect(result.success).toBe(true);
  });

  it('normalises trailing whitespace when comparing', () => {
    const spacedContent = ['line1', 'const x = null;   ', 'line3'].join('\n');
    const result = service.apply(spacedContent, makeFix({ originalCode: 'const x = null;' }));
    expect(result.success).toBe(true);
  });

  it('replaces a multi-line range', () => {
    const multi = ['a', 'b', 'c', 'd'].join('\n');
    const result = service.apply(
      multi,
      makeFix({ startLine: 2, endLine: 3, originalCode: 'b\nc', fixedCode: 'B\nC\nX' }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.newContent).toBe(['a', 'B', 'C', 'X', 'd'].join('\n'));
  });
});
