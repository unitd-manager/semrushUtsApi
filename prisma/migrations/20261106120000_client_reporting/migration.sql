-- CreateTable
CREATE TABLE `ClientReportClient` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `leadId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `notes` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ClientReportClient_leadId_key`(`leadId`),
    INDEX `ClientReportClient_organizationId_isActive_name_idx`(`organizationId`, `isActive`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportWebsite` (
    `clientId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `domainId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClientReportWebsite_projectId_idx`(`projectId`),
    PRIMARY KEY (`clientId`, `domainId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportBranding` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `agencyName` VARCHAR(191) NOT NULL,
    `logoUrl` VARCHAR(191) NULL,
    `primaryColor` VARCHAR(191) NOT NULL DEFAULT '#157d70',
    `secondaryColor` VARCHAR(191) NOT NULL DEFAULT '#173b3c',
    `contactName` VARCHAR(191) NULL,
    `contactEmail` VARCHAR(191) NULL,
    `contactPhone` VARCHAR(191) NULL,
    `websiteUrl` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `disclaimer` TEXT NULL,
    `copyrightText` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ClientReportBranding_organizationId_key`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportTemplate` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClientReportTemplate_organizationId_clientId_updatedAt_idx`(`organizationId`, `clientId`, `updatedAt`),
    UNIQUE INDEX `ClientReportTemplate_organizationId_name_key`(`organizationId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportSection` (
    `id` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `sectionKey` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `position` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `customText` TEXT NULL,
    `configuration` JSON NULL,

    INDEX `ClientReportSection_templateId_position_idx`(`templateId`, `position`),
    UNIQUE INDEX `ClientReportSection_templateId_sectionKey_key`(`templateId`, `sectionKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportSchedule` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `frequency` VARCHAR(191) NOT NULL,
    `scheduleDay` INTEGER NOT NULL DEFAULT 1,
    `scheduleHour` INTEGER NOT NULL DEFAULT 9,
    `scheduleMinute` INTEGER NOT NULL DEFAULT 0,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `approvalRequired` BOOLEAN NOT NULL DEFAULT true,
    `autoDeliveryEnabled` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `nextRunAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `lastError` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ClientReportSchedule_organizationId_isActive_nextRunAt_idx`(`organizationId`, `isActive`, `nextRunAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportScheduleWebsite` (
    `scheduleId` VARCHAR(191) NOT NULL,
    `domainId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,

    INDEX `ClientReportScheduleWebsite_projectId_idx`(`projectId`),
    PRIMARY KEY (`scheduleId`, `domainId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportRecipient` (
    `id` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `recipientType` VARCHAR(191) NOT NULL DEFAULT 'TO',

    INDEX `ClientReportRecipient_scheduleId_idx`(`scheduleId`),
    UNIQUE INDEX `ClientReportRecipient_scheduleId_email_recipientType_key`(`scheduleId`, `email`, `recipientType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReport` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `templateId` VARCHAR(191) NOT NULL,
    `scheduleId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `reportingPeriodStart` DATE NOT NULL,
    `reportingPeriodEnd` DATE NOT NULL,
    `comparisonPeriodStart` DATE NULL,
    `comparisonPeriodEnd` DATE NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    `status` VARCHAR(191) NOT NULL DEFAULT 'GENERATED',
    `dataSnapshot` JSON NOT NULL,
    `commentary` JSON NOT NULL,
    `manualNotes` TEXT NULL,
    `accessTokenHash` VARCHAR(191) NULL,
    `accessExpiresAt` DATETIME(3) NULL,
    `accessRevokedAt` DATETIME(3) NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approvedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ClientReport_accessTokenHash_key`(`accessTokenHash`),
    INDEX `ClientReport_organizationId_status_generatedAt_idx`(`organizationId`, `status`, `generatedAt` DESC),
    INDEX `ClientReport_clientId_reportingPeriodEnd_idx`(`clientId`, `reportingPeriodEnd` DESC),
    UNIQUE INDEX `ClientReport_schedule_period_key`(`scheduleId`, `reportingPeriodStart`, `reportingPeriodEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportIncludedWebsite` (
    `reportId` VARCHAR(191) NOT NULL,
    `domainId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,

    INDEX `ClientReportIncludedWebsite_projectId_idx`(`projectId`),
    PRIMARY KEY (`reportId`, `domainId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportDataSnapshot` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `sourceMap` JSON NOT NULL,
    `freshness` JSON NOT NULL,
    `snapshotAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ClientReportDataSnapshot_reportId_key`(`reportId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportApproval` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `reviewedById` VARCHAR(191) NOT NULL,
    `comments` TEXT NULL,
    `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClientReportApproval_reportId_reviewedAt_idx`(`reportId`, `reviewedAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `recipient` VARCHAR(191) NOT NULL,
    `deliveryChannel` VARCHAR(191) NOT NULL DEFAULT 'EMAIL',
    `status` VARCHAR(191) NOT NULL,
    `providerReference` VARCHAR(191) NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ClientReportDelivery_idempotencyKey_key`(`idempotencyKey`),
    INDEX `ClientReportDelivery_organizationId_status_createdAt_idx`(`organizationId`, `status`, `createdAt` DESC),
    INDEX `ClientReportDelivery_reportId_createdAt_idx`(`reportId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportGenerationLog` (
    `id` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `message` TEXT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ClientReportGenerationLog_reportId_createdAt_idx`(`reportId`, `createdAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ClientReportAccessLog` (
    `id` VARCHAR(191) NOT NULL,
    `organizationId` VARCHAR(191) NOT NULL,
    `reportId` VARCHAR(191) NOT NULL,
    `accessedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userAgent` VARCHAR(512) NULL,
    `ipHash` VARCHAR(64) NULL,

    INDEX `ClientReportAccessLog_organizationId_accessedAt_idx`(`organizationId`, `accessedAt` DESC),
    INDEX `ClientReportAccessLog_reportId_accessedAt_idx`(`reportId`, `accessedAt` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ClientReportClient` ADD CONSTRAINT `ClientReportClient_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportClient` ADD CONSTRAINT `ClientReportClient_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `Lead`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportWebsite` ADD CONSTRAINT `ClientReportWebsite_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `ClientReportClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportWebsite` ADD CONSTRAINT `ClientReportWebsite_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportWebsite` ADD CONSTRAINT `ClientReportWebsite_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportBranding` ADD CONSTRAINT `ClientReportBranding_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportTemplate` ADD CONSTRAINT `ClientReportTemplate_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportTemplate` ADD CONSTRAINT `ClientReportTemplate_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `ClientReportClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportSection` ADD CONSTRAINT `ClientReportSection_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `ClientReportTemplate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportSchedule` ADD CONSTRAINT `ClientReportSchedule_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportSchedule` ADD CONSTRAINT `ClientReportSchedule_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `ClientReportClient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportSchedule` ADD CONSTRAINT `ClientReportSchedule_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `ClientReportTemplate`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportScheduleWebsite` ADD CONSTRAINT `ClientReportScheduleWebsite_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `ClientReportSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportScheduleWebsite` ADD CONSTRAINT `ClientReportScheduleWebsite_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportScheduleWebsite` ADD CONSTRAINT `ClientReportScheduleWebsite_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportRecipient` ADD CONSTRAINT `ClientReportRecipient_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `ClientReportSchedule`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportIncludedWebsite` ADD CONSTRAINT `ClientReportIncludedWebsite_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `ClientReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportIncludedWebsite` ADD CONSTRAINT `ClientReportIncludedWebsite_domainId_fkey` FOREIGN KEY (`domainId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportIncludedWebsite` ADD CONSTRAINT `ClientReportIncludedWebsite_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportDataSnapshot` ADD CONSTRAINT `ClientReportDataSnapshot_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `ClientReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportApproval` ADD CONSTRAINT `ClientReportApproval_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `ClientReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportDelivery` ADD CONSTRAINT `ClientReportDelivery_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportDelivery` ADD CONSTRAINT `ClientReportDelivery_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `ClientReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportGenerationLog` ADD CONSTRAINT `ClientReportGenerationLog_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `ClientReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportAccessLog` ADD CONSTRAINT `ClientReportAccessLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ClientReportAccessLog` ADD CONSTRAINT `ClientReportAccessLog_reportId_fkey` FOREIGN KEY (`reportId`) REFERENCES `ClientReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
