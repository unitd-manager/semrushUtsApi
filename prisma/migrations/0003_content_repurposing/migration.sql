ALTER TABLE `ContentPiece`
  ADD COLUMN `sourceId` VARCHAR(191) NULL,
  ADD COLUMN `format` VARCHAR(191) NOT NULL DEFAULT 'article';

CREATE INDEX `ContentPiece_sourceId_updatedAt_idx` ON `ContentPiece`(`sourceId`, `updatedAt`);

ALTER TABLE `ContentPiece`
  ADD CONSTRAINT `ContentPiece_sourceId_fkey`
  FOREIGN KEY (`sourceId`) REFERENCES `ContentPiece`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
