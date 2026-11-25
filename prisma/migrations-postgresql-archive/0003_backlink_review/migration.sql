CREATE TYPE "BacklinkReviewState" AS ENUM ('NEEDS_REVIEW', 'KEEP', 'REMOVAL_REQUESTED', 'DISAVOW_APPROVED');

CREATE TABLE "BacklinkReview" (
    "id" TEXT NOT NULL,
    "backlinkId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "state" "BacklinkReviewState" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BacklinkReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BacklinkReview_backlinkId_key" ON "BacklinkReview"("backlinkId");
CREATE INDEX "BacklinkReview_state_updatedAt_idx" ON "BacklinkReview"("state", "updatedAt" DESC);
ALTER TABLE "BacklinkReview" ADD CONSTRAINT "BacklinkReview_backlinkId_fkey" FOREIGN KEY ("backlinkId") REFERENCES "Backlink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BacklinkReview" ADD CONSTRAINT "BacklinkReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;