CREATE TABLE "BacklinkSnapshot" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "targetRank" INTEGER,
    "backlinks" INTEGER,
    "referringDomains" INTEGER,
    "referringMainDomains" INTEGER,
    "referringIps" INTEGER,
    "referringPages" INTEGER,
    "brokenBacklinks" INTEGER,
    "backlinkSpamScore" INTEGER,
    "targetSpamScore" INTEGER,
    "provider" TEXT NOT NULL,
    "confidence" "DataConfidence" NOT NULL,
    "metrics" JSONB NOT NULL,

    CONSTRAINT "BacklinkSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BacklinkSnapshot_domainId_observedAt_provider_key" ON "BacklinkSnapshot"("domainId", "observedAt", "provider");
CREATE INDEX "BacklinkSnapshot_domainId_observedAt_idx" ON "BacklinkSnapshot"("domainId", "observedAt" DESC);
ALTER TABLE "BacklinkSnapshot" ADD CONSTRAINT "BacklinkSnapshot_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;