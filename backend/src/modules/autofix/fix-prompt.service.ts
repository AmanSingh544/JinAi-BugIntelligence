import { Injectable } from '@nestjs/common';

const MAX_FILE_TOKENS = 4000; // ~16KB; truncate above this to keep prompt bounded
const CHARS_PER_TOKEN = 4;
const MAX_FILE_CHARS = MAX_FILE_TOKENS * CHARS_PER_TOKEN;

export interface FixPromptContext {
  errorMessage: string;
  stackTrace: string;
  rootCause: string;
  fixSuggestion: string;
  targetFile: string;
  fileContent: string;       // full or truncated file
  errorLine: number;
  language: string;
  requiresApproval: boolean;
}

export interface AiFixResult {
  file: string;
  startLine: number;
  endLine: number;
  originalCode: string;
  fixedCode: string;
  explanation: string;
  confidence: number;
  requiresMultipleFiles: boolean;
}

@Injectable()
export class FixPromptService {
  readonly systemPrompt = `You are an expert software engineer performing automated bug fixes.
You will be given a bug report with root cause analysis and the original source file.
Your task is to produce a minimal, targeted code fix.

Rules:
- Fix ONLY the specific bug described. Do not refactor or clean up unrelated code.
- Output ONLY valid JSON. No markdown, no explanation outside the JSON.
- The originalCode field must be the EXACT text currently at those line numbers — copy it verbatim.
- The fixedCode field is the replacement. Keep indentation consistent with the surrounding code.
- Be conservative: prefer the smallest change that fixes the bug.
- If you cannot determine a safe fix, set confidence below 0.5 and explain in the explanation field.`;

  buildUserPrompt(ctx: FixPromptContext): string {
    const fileContent = this.truncateFile(ctx.fileContent, ctx.errorLine);
    const approvalNote = ctx.requiresApproval
      ? 'Note: This fix will require human approval before merging. Be conservative.'
      : '';

    return `Fix the following bug in ${ctx.targetFile}.

BUG REPORT:
  Error: ${ctx.errorMessage}
  Root cause: ${ctx.rootCause}
  Suggested fix: ${ctx.fixSuggestion}

STACK TRACE:
${ctx.stackTrace}

SOURCE FILE (${ctx.language}):
\`\`\`${ctx.language}
${fileContent}
\`\`\`

The error occurs near line ${ctx.errorLine}.
${approvalNote}

Respond with ONLY this JSON structure (no markdown, no extra text):
{
  "file": "${ctx.targetFile}",
  "startLine": <first line to replace, 1-indexed>,
  "endLine": <last line to replace, 1-indexed>,
  "originalCode": "<exact current content of lines startLine..endLine>",
  "fixedCode": "<replacement code>",
  "explanation": "<one sentence explaining what you changed and why>",
  "confidence": <0.0-1.0>,
  "requiresMultipleFiles": <true if the fix needs changes in other files, else false>
}`;
  }

  private truncateFile(content: string, errorLine: number): string {
    if (content.length <= MAX_FILE_CHARS) return content;

    // Keep ±200 lines around the error line for context
    const lines = content.split('\n');
    const start = Math.max(0, errorLine - 200);
    const end = Math.min(lines.length, errorLine + 200);
    const excerpt = lines.slice(start, end).join('\n');

    if (excerpt.length <= MAX_FILE_CHARS) {
      return `[... file truncated, showing lines ${start + 1}-${end} ...]\n${excerpt}`;
    }

    // If even the excerpt is too large, take the closest ±50 lines
    const tightStart = Math.max(0, errorLine - 50);
    const tightEnd = Math.min(lines.length, errorLine + 50);
    const tight = lines.slice(tightStart, tightEnd).join('\n');
    return `[... file truncated, showing lines ${tightStart + 1}-${tightEnd} ...]\n${tight}`;
  }

  detectLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      py: 'python', rb: 'ruby', go: 'go', java: 'java', cs: 'csharp',
      cpp: 'cpp', c: 'c', rs: 'rust', php: 'php', swift: 'swift',
      kt: 'kotlin', vue: 'vue', svelte: 'svelte',
    };
    return map[ext] ?? ext ?? 'text';
  }

  parseAiResponse(text: string): AiFixResult | null {
    try {
      const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      const parsed = JSON.parse(cleaned) as Partial<AiFixResult>;

      if (
        typeof parsed.file !== 'string' ||
        typeof parsed.startLine !== 'number' ||
        typeof parsed.endLine !== 'number' ||
        typeof parsed.originalCode !== 'string' ||
        typeof parsed.fixedCode !== 'string' ||
        typeof parsed.explanation !== 'string' ||
        typeof parsed.confidence !== 'number'
      ) {
        return null;
      }

      return {
        file: parsed.file,
        startLine: parsed.startLine,
        endLine: parsed.endLine,
        originalCode: parsed.originalCode,
        fixedCode: parsed.fixedCode,
        explanation: parsed.explanation,
        confidence: Math.min(1, Math.max(0, parsed.confidence)),
        requiresMultipleFiles: parsed.requiresMultipleFiles === true,
      };
    } catch {
      return null;
    }
  }
}
