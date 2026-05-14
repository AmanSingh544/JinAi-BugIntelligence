/**
 * One-time migration script: converts existing Release.sourcemap (single file)
 * into ReleaseSourcemap records.
 *
 * Run with:
 *   npx ts-node src/scripts/migrate-sourcemaps.ts
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { SourceMapConsumer } from 'source-map';
import { normalizeMinifiedFilename } from '../modules/releases/sourcemap-upload.service';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Finding releases with legacy sourcemap fields...');

  const releases = await prisma.release.findMany({
    where: { sourcemap: { not: null } },
  });

  console.log(`📦 Found ${releases.length} releases to migrate`);

  let migrated = 0;
  let failed = 0;

  for (const release of releases) {
    if (!release.sourcemap) continue;

    try {
      const buffer = readFileSync(release.sourcemap);
      const raw = buffer.toString('utf-8');
      const parsed = JSON.parse(raw) as { file?: string };
      const declaredFile = parsed.file ?? null;
      const minifiedFilename = declaredFile
        ? normalizeMinifiedFilename(declaredFile)
        : `unknown::${release.id}`;

      let sourcemapParsed = false;
      let sourcemapError: string | null = null;
      try {
        const consumer = await new SourceMapConsumer(raw);
        sourcemapParsed = true;
        consumer.destroy();
      } catch (err) {
        sourcemapError = err instanceof Error ? err.message : 'Parse failed';
      }

      const contentHash = createHash('sha256').update(buffer).digest('hex');

      await prisma.releaseSourcemap.upsert({
        where: {
          release_id_minified_filename: {
            release_id: release.id,
            minified_filename: minifiedFilename,
          },
        },
        create: {
          release_id: release.id,
          minified_filename: minifiedFilename,
          declared_file: declaredFile,
          sourcemap_path: release.sourcemap,
          sourcemap_size: release.sourcemap_size,
          content_hash: contentHash,
          sourcemap_parsed: sourcemapParsed,
          sourcemap_error: sourcemapError,
          parse_warnings: undefined,
        },
        update: {
          declared_file: declaredFile,
          sourcemap_path: release.sourcemap,
          sourcemap_size: release.sourcemap_size,
          content_hash: contentHash,
          sourcemap_parsed: sourcemapParsed,
          sourcemap_error: sourcemapError,
        },
      });

      migrated++;
      console.log(`✅ ${release.version} → ${minifiedFilename}`);
    } catch (err) {
      failed++;
      console.error(`❌ ${release.version}: ${(err as Error).message}`);
    }
  }

  console.log(`\n🎉 Done. ${migrated} migrated, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
