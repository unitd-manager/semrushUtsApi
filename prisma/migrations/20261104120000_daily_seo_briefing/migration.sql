CREATE TABLE `DailySeoBriefingSetting` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `hourUtc` INTEGER NOT NULL DEFAULT 8,
    `minuteUtc` INTEGER NOT NULL DEFAULT 0,
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `DailySeoBriefingSetting_enabled_nextRunAt_idx` (`enabled`, `nextRunAt`),
    UNIQUE INDEX `DailySeoBriefingSetting_organizationId_projectId_key` (`organizationId`, `projectId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `DailySeoBriefingSetting_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `DailySeoBriefingSetting_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DailySeoBriefing` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `briefDate` DATE NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `data` JSON NOT NULL,
    INDEX `DailySeoBriefing_organizationId_generatedAt_idx` (`organizationId`, `generatedAt` DESC),
    UNIQUE INDEX `DailySeoBriefing_organizationId_projectId_briefDate_key` (`organizationId`, `projectId`, `briefDate`),
    PRIMARY KEY (`id`),
    CONSTRAINT `DailySeoBriefing_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `DailySeoBriefing_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
