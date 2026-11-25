-- CreateTable
CREATE TABLE `KeywordPageMapping` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `websiteId` VARCHAR(191) NOT NULL,
    `keywordId` VARCHAR(191) NULL,
    `phrase` VARCHAR(200) NOT NULL,
    `pageUrl` VARCHAR(2048) NOT NULL,
    `pageKey` CHAR(64) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'PRIMARY',
    `searchIntent` VARCHAR(191) NULL,
    `confidence` DOUBLE NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING_REVIEW',
    `decisionNote` TEXT NULL,
    `approvedById` VARCHAR(191) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `KeywordPageMapping_organizationId_projectId_status_updatedAt_idx`(`organizationId`, `projectId`, `status`, `updatedAt` DESC),
    INDEX `KeywordPageMapping_websiteId_phrase_status_idx`(`websiteId`, `phrase`, `status`),
    INDEX `KeywordPageMapping_keywordId_updatedAt_idx`(`keywordId`, `updatedAt` DESC),
    UNIQUE INDEX `KeywordPageMapping_organizationId_projectId_phrase_pageKey_key`(`organizationId`, `projectId`, `phrase`, `pageKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `KeywordPageMappingHistory` (
    `id` VARCHAR(191) NOT NULL,
    `mappingId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `before` JSON NULL,
    `after` JSON NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `KeywordPageMappingHistory_mappingId_createdAt_idx`(`mappingId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `ContentVersion` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `contentPieceId` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NULL,
    `body` LONGTEXT NULL,
    `targetKeyword` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `changeNote` TEXT NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContentVersion_organizationId_contentPieceId_createdAt_idx`(`organizationId`, `contentPieceId`, `createdAt` DESC),
    UNIQUE INDEX `ContentVersion_contentPieceId_version_key`(`contentPieceId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `ContentReview` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `contentPieceId` VARCHAR(191) NOT NULL,
    `versionId` VARCHAR(191) NOT NULL,
    `reviewerId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `comments` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,

    INDEX `ContentReview_organizationId_status_createdAt_idx`(`organizationId`, `status`, `createdAt` DESC),
    INDEX `ContentReview_contentPieceId_versionId_createdAt_idx`(`contentPieceId`, `versionId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `CompetitorMonitor` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `websiteId` VARCHAR(191) NOT NULL,
    `competitorId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `frequencyHours` INTEGER NOT NULL DEFAULT 24,
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `CompetitorMonitor_organizationId_enabled_nextRunAt_idx`(`organizationId`, `enabled`, `nextRunAt`),
    INDEX `CompetitorMonitor_projectId_enabled_idx`(`projectId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `CompetitorPageSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `competitorId` VARCHAR(191) NOT NULL,
    `monitorId` VARCHAR(191) NOT NULL,
    `url` VARCHAR(2048) NOT NULL,
    `observedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `statusCode` INTEGER NULL,
    `title` VARCHAR(1000) NULL,
    `description` TEXT NULL,
    `h1` VARCHAR(1000) NULL,
    `canonical` VARCHAR(2048) NULL,
    `robots` VARCHAR(500) NULL,
    `contentDigest` VARCHAR(191) NULL,
    `headings` JSON NULL,
    `structuredData` JSON NULL,
    `provider` VARCHAR(191) NOT NULL DEFAULT 'first_party_crawler',
    `confidence` ENUM('FIRST_PARTY', 'PROVIDER_OBSERVED', 'PROVIDER_ESTIMATE', 'USER_ENTERED', 'SAMPLE', 'UNAVAILABLE') NOT NULL DEFAULT 'FIRST_PARTY',

    INDEX `CompetitorPageSnapshot_competitorId_observedAt_idx`(`competitorId`, `observedAt` DESC),
    INDEX `CompetitorPageSnapshot_monitorId_observedAt_idx`(`monitorId`, `observedAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `CompetitorChangeEvent` (
    `id` VARCHAR(191) NOT NULL,
    `competitorId` VARCHAR(191) NOT NULL,
    `monitorId` VARCHAR(191) NOT NULL,
    `beforeSnapshotId` VARCHAR(191) NULL,
    `afterSnapshotId` VARCHAR(191) NOT NULL,
    `changeType` VARCHAR(191) NOT NULL,
    `risk` VARCHAR(191) NOT NULL DEFAULT 'LOW',
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `evidence` JSON NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CompetitorChangeEvent_dedupeKey_key`(`dedupeKey`),
    INDEX `CompetitorChangeEvent_competitorId_status_createdAt_idx`(`competitorId`, `status`, `createdAt` DESC),
    INDEX `CompetitorChangeEvent_monitorId_createdAt_idx`(`monitorId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `SeoSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `websiteId` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `recurrence` JSON NOT NULL,
    `payload` JSON NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SeoSchedule_organizationId_enabled_nextRunAt_idx`(`organizationId`, `enabled`, `nextRunAt`),
    INDEX `SeoSchedule_projectId_enabled_nextRunAt_idx`(`projectId`, `enabled`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `SeoScheduleExecution` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `occurrenceKey` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'QUEUED',
    `attempt` INTEGER NOT NULL DEFAULT 0,
    `result` JSON NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SeoScheduleExecution_occurrenceKey_key`(`occurrenceKey`),
    INDEX `SeoScheduleExecution_organizationId_status_scheduledAt_idx`(`organizationId`, `status`, `scheduledAt` DESC),
    INDEX `SeoScheduleExecution_scheduleId_scheduledAt_idx`(`scheduleId`, `scheduledAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;


-- CreateTable
CREATE TABLE `BackgroundJob` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `payload` JSON NOT NULL,
    `dedupeKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 5,
    `runAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,
    `lockedBy` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `finishedAt` DATETIME(3) NULL,

    UNIQUE INDEX `BackgroundJob_dedupeKey_key`(`dedupeKey`),
    INDEX `BackgroundJob_status_runAt_leaseExpiresAt_idx`(`status`, `runAt`, `leaseExpiresAt`),
    INDEX `BackgroundJob_organizationId_createdAt_idx`(`organizationId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `KeywordPageMapping` ADD CONSTRAINT `KeywordPageMapping_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `KeywordPageMapping` ADD CONSTRAINT `KeywordPageMapping_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `KeywordPageMapping` ADD CONSTRAINT `KeywordPageMapping_websiteId_fkey` FOREIGN KEY (`websiteId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `KeywordPageMapping` ADD CONSTRAINT `KeywordPageMapping_keywordId_fkey` FOREIGN KEY (`keywordId`) REFERENCES `Keyword`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `KeywordPageMappingHistory` ADD CONSTRAINT `KeywordPageMappingHistory_mappingId_fkey` FOREIGN KEY (`mappingId`) REFERENCES `KeywordPageMapping`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `ContentVersion` ADD CONSTRAINT `ContentVersion_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `ContentVersion` ADD CONSTRAINT `ContentVersion_contentPieceId_fkey` FOREIGN KEY (`contentPieceId`) REFERENCES `ContentPiece`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `ContentReview` ADD CONSTRAINT `ContentReview_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `ContentReview` ADD CONSTRAINT `ContentReview_contentPieceId_fkey` FOREIGN KEY (`contentPieceId`) REFERENCES `ContentPiece`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `ContentReview` ADD CONSTRAINT `ContentReview_versionId_fkey` FOREIGN KEY (`versionId`) REFERENCES `ContentVersion`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorMonitor` ADD CONSTRAINT `CompetitorMonitor_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorMonitor` ADD CONSTRAINT `CompetitorMonitor_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorMonitor` ADD CONSTRAINT `CompetitorMonitor_websiteId_fkey` FOREIGN KEY (`websiteId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorMonitor` ADD CONSTRAINT `CompetitorMonitor_competitorId_fkey` FOREIGN KEY (`competitorId`) REFERENCES `Competitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorPageSnapshot` ADD CONSTRAINT `CompetitorPageSnapshot_competitorId_fkey` FOREIGN KEY (`competitorId`) REFERENCES `Competitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorPageSnapshot` ADD CONSTRAINT `CompetitorPageSnapshot_monitorId_fkey` FOREIGN KEY (`monitorId`) REFERENCES `CompetitorMonitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorChangeEvent` ADD CONSTRAINT `CompetitorChangeEvent_competitorId_fkey` FOREIGN KEY (`competitorId`) REFERENCES `Competitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorChangeEvent` ADD CONSTRAINT `CompetitorChangeEvent_monitorId_fkey` FOREIGN KEY (`monitorId`) REFERENCES `CompetitorMonitor`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorChangeEvent` ADD CONSTRAINT `CompetitorChangeEvent_beforeSnapshotId_fkey` FOREIGN KEY (`beforeSnapshotId`) REFERENCES `CompetitorPageSnapshot`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `CompetitorChangeEvent` ADD CONSTRAINT `CompetitorChangeEvent_afterSnapshotId_fkey` FOREIGN KEY (`afterSnapshotId`) REFERENCES `CompetitorPageSnapshot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `SeoSchedule` ADD CONSTRAINT `SeoSchedule_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `SeoSchedule` ADD CONSTRAINT `SeoSchedule_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `SeoSchedule` ADD CONSTRAINT `SeoSchedule_websiteId_fkey` FOREIGN KEY (`websiteId`) REFERENCES `Domain`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `SeoScheduleExecution` ADD CONSTRAINT `SeoScheduleExecution_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `SeoScheduleExecution` ADD CONSTRAINT `SeoScheduleExecution_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `SeoSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE `BackgroundJob` ADD CONSTRAINT `BackgroundJob_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
