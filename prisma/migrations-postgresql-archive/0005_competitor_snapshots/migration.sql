CREATE TABLE "CompetitorSnapshot" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "confidence" "DataConfidence" NOT NULL,
    "totalCount" INTEGER,
    "metrics" JSONB NOT NULL,
    "keywords" JSONB NOT NULL,
    CONSTRAINT "CompetitorSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CompetitorSnapshot_competitorId_kind_observedAt_idx" ON "CompetitorSnapshot"("competitorId", "kind", "observedAt" DESC);

ALTER TABLE "CompetitorSnapshot" ADD CONSTRAINT "CompetitorSnapshot_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
