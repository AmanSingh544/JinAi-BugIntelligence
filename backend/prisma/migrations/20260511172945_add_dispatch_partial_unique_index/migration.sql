-- Partial unique index: only one successful delivery per bug+integration pair.
-- This is the final guardrail against duplicate ticket creation even if
-- Redis locks fail, TTL expires, or network partitions occur.
CREATE UNIQUE INDEX IF NOT EXISTS integration_delivery_unique_success_idx
ON "IntegrationDelivery"(bug_id, integration_id)
WHERE status = 'success';
