import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SourceMapConsumer } from 'source-map';
import { createHash, randomUUID } from 'crypto';
import {
  mkdirSync,
  createReadStream,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
  rmSync,
} from 'fs';
import { dirname, basename, join } from 'path';
import * as yauzl from 'yauzl';

const UPLOAD_DIR = './uploads/sourcemaps';
const TMP_DIR = './uploads/sourcemaps/tmp';

// Guardrails
const MAX_ZIP_SIZE = 100 * 1024 * 1024;      // 100 MB
const MAX_EXTRACTED_SIZE = 250 * 1024 * 1024; // 250 MB
const MAX_COMPRESSION_RATIO = 20;             // 20:1
const MAX_FILES_IN_ARCHIVE = 200;
const MAX_SINGLE_SOURCEMAP_SIZE = 50 * 1024 * 1024; // 50 MB

export interface SourcemapUploadResult {
  id: string;
  minified_filename: string;
  declared_file: string | null;
  sourcemap_parsed: boolean;
  sourcemap_size: number | null;
  content_hash: string | null;
  sourcemap_error: string | null;
  parse_warnings: unknown[] | null;
}

export function normalizeMinifiedFilename(raw: string): string {
  try {
    raw = new URL(raw).pathname;
  } catch {
    // not a URL, keep as-is
  }
  return (
    raw
      .replace(/^(webpack:\/\/\/|vite:\/\/\/)/, '')
      .replace(/[?#].*$/, '')
      .split('/')
      .pop() || raw
  );
}

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseSourcemapJson(buffer: Buffer): { file?: string } | null {
  try {
    const str = buffer.toString('utf-8', 0, Math.min(buffer.length, 10 * 1024 * 1024));
    return JSON.parse(str) as { file?: string };
  } catch {
    return null;
  }
}

@Injectable()
export class SourcemapUploadService {
  private readonly logger = new Logger(SourcemapUploadService.name);

  constructor(private readonly prisma: PrismaService) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    mkdirSync(TMP_DIR, { recursive: true });
  }

  /**
   * Process a single sourcemap upload with atomic file replacement.
   */
  async processSingleUpload(
    releaseId: string,
    buffer: Buffer,
    uploadedFilename: string,
    providedMinifiedFilename?: string,
  ): Promise<SourcemapUploadResult> {
    const declaredFile = this.extractDeclaredFile(buffer, uploadedFilename);
    const minifiedFilename = providedMinifiedFilename
      ? normalizeMinifiedFilename(providedMinifiedFilename)
      : normalizeMinifiedFilename(declaredFile || uploadedFilename);

    const contentHash = computeHash(buffer);

    // Check for existing identical upload (idempotency)
    const existing = await this.prisma.releaseSourcemap.findUnique({
      where: { release_id_minified_filename: { release_id: releaseId, minified_filename: minifiedFilename } },
    });
    if (existing && existing.content_hash === contentHash) {
      this.logger.debug(`Idempotent skip: identical sourcemap already exists for ${minifiedFilename}`);
      return this.mapToResult(existing);
    }

    // 1. Write to temp path
    const tempPath = join(TMP_DIR, `${randomUUID()}.map`);
    writeFileSync(tempPath, buffer);

    let sourcemapParsed = false;
    let sourcemapError: string | undefined;
    const parseWarnings: string[] = [];

    try {
      // 2. Validate
      const raw = readFileSync(tempPath, 'utf-8');
      const consumer = await new SourceMapConsumer(raw);
      sourcemapParsed = true;
      consumer.destroy();
    } catch (err) {
      sourcemapParsed = false;
      sourcemapError = err instanceof Error ? err.message : 'Sourcemap parse failed';
    }

    // 3. Move to permanent path
    const permanentPath = join(UPLOAD_DIR, `${Date.now()}-${randomUUID()}.map`);
    renameSync(tempPath, permanentPath);

    // 4. Upsert DB row
    const record = await this.prisma.releaseSourcemap.upsert({
      where: {
        release_id_minified_filename: {
          release_id: releaseId,
          minified_filename: minifiedFilename,
        },
      },
      create: {
        release_id: releaseId,
        minified_filename: minifiedFilename,
        declared_file: declaredFile,
        sourcemap_path: permanentPath,
        sourcemap_size: buffer.length,
        content_hash: contentHash,
        sourcemap_parsed: sourcemapParsed,
        sourcemap_error: sourcemapError ?? null,
        parse_warnings: parseWarnings.length > 0 ? parseWarnings : undefined,
      },
      update: {
        declared_file: declaredFile,
        sourcemap_path: permanentPath,
        sourcemap_size: buffer.length,
        content_hash: contentHash,
        sourcemap_parsed: sourcemapParsed,
        sourcemap_error: sourcemapError ?? null,
        parse_warnings: parseWarnings.length > 0 ? parseWarnings : undefined,
        uploaded_at: new Date(),
      },
    });

    // 5. Delete old file after successful DB commit
    if (existing?.sourcemap_path && existing.sourcemap_path !== permanentPath) {
      try {
        unlinkSync(existing.sourcemap_path);
      } catch {
        // ignore cleanup failures
      }
    }

    return this.mapToResult(record);
  }

  /**
   * Process a ZIP batch upload with streaming and security guardrails.
   */
  async processZipBatchUpload(
    releaseId: string,
    zipBuffer: Buffer,
  ): Promise<SourcemapUploadResult[]> {
    // Guardrail: ZIP size
    if (zipBuffer.length > MAX_ZIP_SIZE) {
      throw new BadRequestException(
        `ZIP upload too large: ${zipBuffer.length} bytes (max ${MAX_ZIP_SIZE})`,
      );
    }

    const tmpZipPath = join(TMP_DIR, `${randomUUID()}.zip`);
    writeFileSync(tmpZipPath, zipBuffer);

    return new Promise((resolve, reject) => {
      const results: SourcemapUploadResult[] = [];
      let totalExtractedSize = 0;
      let fileCount = 0;

      yauzl.open(tmpZipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          rmSync(tmpZipPath, { force: true });
          return reject(new BadRequestException(`Invalid ZIP: ${err.message}`));
        }

        zipfile.readEntry();

        zipfile.on('entry', async (entry: yauzl.Entry) => {
          // Reject nested archives
          if (/\.(zip|tar|gz|rar|7z)$/i.test(entry.fileName)) {
            zipfile.close();
            rmSync(tmpZipPath, { force: true });
            return reject(new BadRequestException(`Nested archives not allowed: ${entry.fileName}`));
          }

          // Reject directories
          if (entry.fileName.endsWith('/')) {
            zipfile.readEntry();
            return;
          }

          // Reject path traversal
          if (entry.fileName.includes('..') || entry.fileName.startsWith('/') || entry.fileName.startsWith('\\')) {
            zipfile.close();
            rmSync(tmpZipPath, { force: true });
            return reject(new BadRequestException(`Path traversal rejected: ${entry.fileName}`));
          }

          fileCount++;
          if (fileCount > MAX_FILES_IN_ARCHIVE) {
            zipfile.close();
            rmSync(tmpZipPath, { force: true });
            return reject(new BadRequestException(`Too many files in ZIP (max ${MAX_FILES_IN_ARCHIVE})`));
          }

          // Only process .map files
          if (!entry.fileName.endsWith('.map')) {
            zipfile.readEntry();
            return;
          }

          // Check uncompressed size guardrail
          if (entry.uncompressedSize > MAX_SINGLE_SOURCEMAP_SIZE) {
            zipfile.close();
            rmSync(tmpZipPath, { force: true });
            return reject(
              new BadRequestException(
                `Sourcemap too large: ${entry.fileName} (${entry.uncompressedSize} bytes, max ${MAX_SINGLE_SOURCEMAP_SIZE})`,
              ),
            );
          }

          totalExtractedSize += entry.uncompressedSize;
          if (totalExtractedSize > MAX_EXTRACTED_SIZE) {
            zipfile.close();
            rmSync(tmpZipPath, { force: true });
            return reject(
              new BadRequestException(
                `Total extracted size exceeds ${MAX_EXTRACTED_SIZE} bytes`,
              ),
            );
          }

          // Check compression ratio
          const ratio = entry.compressedSize > 0
            ? entry.uncompressedSize / entry.compressedSize
            : 1;
          if (ratio > MAX_COMPRESSION_RATIO) {
            zipfile.close();
            rmSync(tmpZipPath, { force: true });
            return reject(
              new BadRequestException(
                `Suspicious compression ratio for ${entry.fileName} (${ratio.toFixed(1)}:1, max ${MAX_COMPRESSION_RATIO}:1)`,
              ),
            );
          }

          zipfile.openReadStream(entry, async (readErr, readStream) => {
            if (readErr) {
              zipfile.close();
              rmSync(tmpZipPath, { force: true });
              return reject(readErr);
            }

            const chunks: Buffer[] = [];
            readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
            readStream.on('end', async () => {
              try {
                const buffer = Buffer.concat(chunks);
                const zipEntryBasename = basename(entry.fileName);

                // Compare declared file vs ZIP entry name
                const declaredFile = this.extractDeclaredFile(buffer, zipEntryBasename);
                const normalizedDeclared = normalizeMinifiedFilename(declaredFile || '');
                const normalizedZipEntry = normalizeMinifiedFilename(zipEntryBasename);
                if (declaredFile && normalizedDeclared !== normalizedZipEntry) {
                  this.logger.warn(
                    `Sourcemap declared file mismatch: ZIP entry "${zipEntryBasename}" declares "${declaredFile}" (normalized: ${normalizedDeclared})`,
                  );
                }

                const result = await this.processSingleUpload(
                  releaseId,
                  buffer,
                  zipEntryBasename,
                );
                results.push(result);
                zipfile.readEntry();
              } catch (procErr) {
                zipfile.close();
                rmSync(tmpZipPath, { force: true });
                reject(procErr);
              }
            });
            readStream.on('error', (streamErr) => {
              zipfile.close();
              rmSync(tmpZipPath, { force: true });
              reject(streamErr);
            });
          });
        });

        zipfile.on('end', () => {
          rmSync(tmpZipPath, { force: true });
          resolve(results);
        });

        zipfile.on('error', (zipErr) => {
          rmSync(tmpZipPath, { force: true });
          reject(zipErr);
        });
      });
    });
  }

  /**
   * List sourcemaps for a release (paginated).
   */
  async listSourcemaps(releaseId: string, limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      this.prisma.releaseSourcemap.findMany({
        where: { release_id: releaseId },
        orderBy: { uploaded_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.releaseSourcemap.count({ where: { release_id: releaseId } }),
    ]);

    return { items, total, limit, offset };
  }

  private extractDeclaredFile(buffer: Buffer, fallbackFilename: string): string | null {
    const parsed = parseSourcemapJson(buffer);
    return parsed?.file ?? null;
  }

  private mapToResult(record: any): SourcemapUploadResult {
    return {
      id: record.id,
      minified_filename: record.minified_filename,
      declared_file: record.declared_file,
      sourcemap_parsed: record.sourcemap_parsed,
      sourcemap_size: record.sourcemap_size,
      content_hash: record.content_hash,
      sourcemap_error: record.sourcemap_error,
      parse_warnings: record.parse_warnings as unknown[] | null,
    };
  }
}
