-- Add websiteUrl to Tenant for product deep-linking
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "websiteUrl" TEXT;

-- Add externalSku to Design for SKU-based deep-linking
ALTER TABLE "Design" ADD COLUMN IF NOT EXISTS "externalSku" TEXT;

-- Auto-populate externalSku from name for all existing designs where name is unique within the tenant.
-- Designs with duplicate names within a tenant are left as NULL (they can be set manually via admin UI).
UPDATE "Design" d
SET "externalSku" = d."name"
WHERE d."externalSku" IS NULL
  AND (
    SELECT COUNT(*) FROM "Design" d2
    WHERE d2."tenantId" = d."tenantId"
      AND d2."name" = d."name"
  ) = 1;

-- Composite unique: a SKU must be unique within a tenant (NULLs are exempt via partial index)
CREATE UNIQUE INDEX IF NOT EXISTS "Design_tenantId_externalSku_key"
  ON "Design"("tenantId", "externalSku")
  WHERE "externalSku" IS NOT NULL;
