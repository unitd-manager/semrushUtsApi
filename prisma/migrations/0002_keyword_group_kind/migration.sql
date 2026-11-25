ALTER TABLE `KeywordList`
  ADD COLUMN `kind` VARCHAR(191) NOT NULL DEFAULT 'LIST',
  ADD INDEX `KeywordList_organizationId_kind_idx`(`organizationId`, `kind`);
