import type { Prisma } from '@prisma/client';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface RuleCondition {
  field: 'error.severity' | 'error.status_code' | 'cluster.occurrences' | 'session.unique_users';
  op: '=' | '>=' | '<=' | '>';
  value: string | number;
}

export interface RuleConditions {
  all: RuleCondition[];
}

interface EvalContext {
  severity: Severity;
  statusCode: number | null;
  clusterOccurrences: number;
  uniqueUsers: number;
}

const SEVERITY_ORDER: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function evaluateRule(conditions: RuleConditions, ctx: EvalContext): boolean {
  return conditions.all.every((c) => evalCondition(c, ctx));
}

function evalCondition(c: RuleCondition, ctx: EvalContext): boolean {
  const { field, op, value } = c;

  switch (field) {
    case 'error.severity': {
      const condLevel = SEVERITY_ORDER[value as Severity] ?? -1;
      const actual = SEVERITY_ORDER[ctx.severity];
      return compare(actual, op, condLevel);
    }
    case 'error.status_code': {
      if (ctx.statusCode === null) return false;
      return compare(ctx.statusCode, op, Number(value));
    }
    case 'cluster.occurrences':
      return compare(ctx.clusterOccurrences, op, Number(value));
    case 'session.unique_users':
      return compare(ctx.uniqueUsers, op, Number(value));
    default:
      return false;
  }
}

function compare(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case '=': return actual === expected;
    case '>=': return actual >= expected;
    case '<=': return actual <= expected;
    case '>': return actual > expected;
    default: return false;
  }
}

export function parseConditions(raw: Prisma.JsonValue): RuleConditions {
  const parsed = raw as { all?: unknown[] };
  if (!parsed?.all || !Array.isArray(parsed.all)) return { all: [] };
  return { all: parsed.all as RuleCondition[] };
}
