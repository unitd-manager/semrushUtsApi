ALTER TABLE `Campaign`
  ADD COLUMN `dedupeKey` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `Campaign_dedupeKey_key`(`dedupeKey`);
