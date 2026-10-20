-- CreateTable
CREATE TABLE "AiSession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New session',
    "designId" TEXT,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "trendProfile" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiSession_platformUserId_idx" ON "AiSession"("platformUserId");

-- CreateIndex
CREATE INDEX "AiSession_tenantId_idx" ON "AiSession"("tenantId");
