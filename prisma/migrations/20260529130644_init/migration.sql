-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "sourceBmpUrl" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "palette" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Yarn" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hex" TEXT NOT NULL,
    "material" TEXT,
    "pileType" TEXT,
    "swatchImageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Yarn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColorwaySubmission" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "notes" TEXT,
    "snapshotUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ColorwaySubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionColorMapping" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "originalHex" TEXT NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "yarnId" TEXT NOT NULL,

    CONSTRAINT "SubmissionColorMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Design_slug_key" ON "Design"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Yarn_code_key" ON "Yarn"("code");

-- AddForeignKey
ALTER TABLE "ColorwaySubmission" ADD CONSTRAINT "ColorwaySubmission_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionColorMapping" ADD CONSTRAINT "SubmissionColorMapping_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "ColorwaySubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionColorMapping" ADD CONSTRAINT "SubmissionColorMapping_yarnId_fkey" FOREIGN KEY ("yarnId") REFERENCES "Yarn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
