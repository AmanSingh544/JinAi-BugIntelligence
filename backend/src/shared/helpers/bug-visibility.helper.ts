import { Prisma } from '@prisma/client';

export function bugVisibilityWhere(
  includeArchived?: boolean,
): Prisma.BugWhereInput {
  return includeArchived ? {} : { archived_at: null };
}
