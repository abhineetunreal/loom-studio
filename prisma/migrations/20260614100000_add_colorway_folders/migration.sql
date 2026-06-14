-- AddColorwayFolders migration
-- 1. Drop the unique constraint that prevented multiple saves per user per design
-- 2. Add new columns to SavedColorway
-- 3. Create ColorwayFolder table
-- 4. Add FK from SavedColorway to ColorwayFolder

-- Drop unique constraint
DROP INDEX IF EXISTS "SavedColorway_designId_userId_key";

-- Add new columns to SavedColorway
ALTER TABLE "SavedColorway"
  ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Untitled',
  ADD COLUMN IF NOT EXISTS "userEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "operations" JSONB,
  ADD COLUMN IF NOT EXISTS "folderId" TEXT;

-- Create ColorwayFolder table
CREATE TABLE IF NOT EXISTS "ColorwayFolder" (
  "id"        TEXT         NOT NULL,
  "tenantId"  TEXT         NOT NULL,
  "userId"    TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ColorwayFolder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ColorwayFolder_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ColorwayFolder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "TenantUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ColorwayFolder_userId_name_key" ON "ColorwayFolder"("userId", "name");

-- Add FK from SavedColorway to ColorwayFolder
ALTER TABLE "SavedColorway"
  ADD CONSTRAINT "SavedColorway_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "ColorwayFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
