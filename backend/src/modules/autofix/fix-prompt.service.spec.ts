import { Test } from '@nestjs/testing';
import { FixPromptService } from './fix-prompt.service';

describe('FixPromptService', () => {
  let service: FixPromptService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({ providers: [FixPromptService] }).compile();
    service = module.get(FixPromptService);
  });

  describe('detectLanguage', () => {
    it.each([
      ['src/app.ts', 'typescript'],
      ['src/App.tsx', 'typescript'],
      ['index.js', 'javascript'],
      ['main.py', 'python'],
      ['handler.go', 'go'],
      ['unknown.xyz', 'xyz'],
    ])('detects %s as %s', (path, lang) => {
      expect(service.detectLanguage(path)).toBe(lang);
    });
  });

  describe('parseAiResponse', () => {
    const valid = {
      file: 'src/app.ts',
      startLine: 10,
      endLine: 12,
      originalCode: 'const x = null;',
      fixedCode: 'const x = 0;',
      explanation: 'Replaced null with 0',
      confidence: 0.9,
      requiresMultipleFiles: false,
    };

    it('parses a valid JSON response', () => {
      const result = service.parseAiResponse(JSON.stringify(valid));
      expect(result).not.toBeNull();
      expect(result!.file).toBe('src/app.ts');
      expect(result!.confidence).toBe(0.9);
      expect(result!.requiresMultipleFiles).toBe(false);
    });

    it('strips markdown code fences', () => {
      const result = service.parseAiResponse('```json\n' + JSON.stringify(valid) + '\n```');
      expect(result).not.toBeNull();
      expect(result!.startLine).toBe(10);
    });

    it('clamps confidence to [0, 1]', () => {
      const over = service.parseAiResponse(JSON.stringify({ ...valid, confidence: 1.5 }));
      expect(over!.confidence).toBe(1);
      const under = service.parseAiResponse(JSON.stringify({ ...valid, confidence: -0.5 }));
      expect(under!.confidence).toBe(0);
    });

    it('returns null when a required field is missing', () => {
      const { file: _file, ...noFile } = valid;
      expect(service.parseAiResponse(JSON.stringify(noFile))).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      expect(service.parseAiResponse('not json')).toBeNull();
    });

    it('treats missing requiresMultipleFiles as false', () => {
      const { requiresMultipleFiles: _r, ...noFlag } = valid;
      const result = service.parseAiResponse(JSON.stringify(noFlag));
      expect(result!.requiresMultipleFiles).toBe(false);
    });
  });

  describe('buildUserPrompt', () => {
    it('includes error message and target file', () => {
      const prompt = service.buildUserPrompt({
        errorMessage: 'Cannot read property of null',
        stackTrace: 'at app.ts:10',
        rootCause: 'Null dereference',
        fixSuggestion: 'Add null check',
        targetFile: 'src/app.ts',
        fileContent: 'const x = obj.value;',
        errorLine: 10,
        language: 'typescript',
        requiresApproval: false,
      });
      expect(prompt).toContain('Cannot read property of null');
      expect(prompt).toContain('src/app.ts');
    });

    it('includes approval note when requiresApproval is true', () => {
      const prompt = service.buildUserPrompt({
        errorMessage: 'err',
        stackTrace: '',
        rootCause: '',
        fixSuggestion: '',
        targetFile: 'a.ts',
        fileContent: '',
        errorLine: 1,
        language: 'typescript',
        requiresApproval: true,
      });
      expect(prompt).toContain('human approval');
    });
  });
});
