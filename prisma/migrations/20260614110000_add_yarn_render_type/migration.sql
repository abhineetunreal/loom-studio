-- Add render type and KPSI to Yarn (YarnColor model)
ALTER TABLE "Yarn" ADD COLUMN IF NOT EXISTS "renderType" TEXT NOT NULL DEFAULT 'shader';
ALTER TABLE "Yarn" ADD COLUMN IF NOT EXISTS "textureKpsi" INTEGER;
