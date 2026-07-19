import { defineConfig } from 'prisma/config';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL!,
    // Serverless Postgres (Neon et al.) splits traffic: pooled URL for the
    // app, direct URL for migrations. Locally both are the same connection.
    directUrl: process.env.DIRECT_URL ?? process.env.DATABASE_URL!,
  },
});
