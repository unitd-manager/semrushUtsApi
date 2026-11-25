CREATE TABLE `SeoFixCenterSetting` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `titleMinLength` INTEGER NOT NULL DEFAULT 30,
  `titleMaxLength` INTEGER NOT NULL DEFAULT 60,
  `descriptionMinLength` INTEGER NOT NULL DEFAULT 120,
  `descriptionMaxLength` INTEGER NOT NULL DEFAULT 160,
  `approvalRequired` BOOLEAN NOT NULL DEFAULT true,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SeoFixCenterSetting_organizationId_projectId_key` (`organizationId`, `projectId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixCenterSetting_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixCenterSetting_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFix` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `websiteId` VARCHAR(191) NOT NULL,
  `auditIssueId` VARCHAR(191) NOT NULL,
  `subresourceKey` VARCHAR(191) NOT NULL DEFAULT '',
  `pageUrl` VARCHAR(512) NOT NULL,
  `issueType` VARCHAR(191) NOT NULL,
  `severity` ENUM('CRITICAL','ERROR','WARNING','NOTICE') NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'DETECTED',
  `detectedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SeoFix_auditIssueId_subresourceKey_key` (`auditIssueId`,`subresourceKey`),
  INDEX `SeoFix_organizationId_projectId_status_detectedAt_idx` (`organizationId`,`projectId`,`status`,`detectedAt` DESC),
  INDEX `SeoFix_organizationId_issueType_severity_idx` (`organizationId`,`issueType`,`severity`),
  INDEX `SeoFix_websiteId_pageUrl_idx` (`websiteId`,`pageUrl`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFix_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFix_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFix_websiteId_fkey` FOREIGN KEY (`websiteId`) REFERENCES `Domain`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFix_auditIssueId_fkey` FOREIGN KEY (`auditIssueId`) REFERENCES `AuditIssue`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFixProposal` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fixId` VARCHAR(191) NOT NULL,
  `version` INTEGER NOT NULL,
  `originalState` JSON NOT NULL,
  `proposedState` JSON NOT NULL,
  `explanation` TEXT NOT NULL,
  `expectedBenefit` TEXT NOT NULL,
  `confidence` DOUBLE NOT NULL,
  `riskLevel` VARCHAR(191) NOT NULL,
  `evidence` JSON NOT NULL,
  `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdById` VARCHAR(191) NOT NULL,
  UNIQUE INDEX `SeoFixProposal_fixId_version_key` (`fixId`,`version`),
  INDEX `SeoFixProposal_organizationId_generatedAt_idx` (`organizationId`,`generatedAt` DESC),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixProposal_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixProposal_fixId_fkey` FOREIGN KEY (`fixId`) REFERENCES `SeoFix`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFixApproval` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fixId` VARCHAR(191) NOT NULL,
  `proposalId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `approvedById` VARCHAR(191) NOT NULL,
  `comments` TEXT NULL,
  `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SeoFixApproval_proposalId_key` (`proposalId`),
  INDEX `SeoFixApproval_organizationId_status_reviewedAt_idx` (`organizationId`,`status`,`reviewedAt` DESC),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixApproval_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixApproval_fixId_fkey` FOREIGN KEY (`fixId`) REFERENCES `SeoFix`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixApproval_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `SeoFixProposal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFixExecution` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fixId` VARCHAR(191) NOT NULL,
  `proposalId` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `adapterType` VARCHAR(191) NOT NULL,
  `executionStatus` VARCHAR(191) NOT NULL,
  `executedById` VARCHAR(191) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `errorMessage` TEXT NULL,
  `verificationStatus` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
  `result` JSON NULL,
  UNIQUE INDEX `SeoFixExecution_idempotencyKey_key` (`idempotencyKey`),
  UNIQUE INDEX `SeoFixExecution_fixId_proposalId_key` (`fixId`,`proposalId`),
  INDEX `SeoFixExecution_organizationId_executionStatus_startedAt_idx` (`organizationId`,`executionStatus`,`startedAt` DESC),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixExecution_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixExecution_fixId_fkey` FOREIGN KEY (`fixId`) REFERENCES `SeoFix`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixExecution_proposalId_fkey` FOREIGN KEY (`proposalId`) REFERENCES `SeoFixProposal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFixSnapshot` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fixId` VARCHAR(191) NOT NULL,
  `executionId` VARCHAR(191) NOT NULL,
  `beforeState` JSON NOT NULL,
  `afterState` JSON NULL,
  `rollbackSupported` BOOLEAN NOT NULL DEFAULT false,
  `snapshotSource` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SeoFixSnapshot_executionId_key` (`executionId`),
  INDEX `SeoFixSnapshot_fixId_createdAt_idx` (`fixId`,`createdAt` DESC),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixSnapshot_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixSnapshot_fixId_fkey` FOREIGN KEY (`fixId`) REFERENCES `SeoFix`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixSnapshot_executionId_fkey` FOREIGN KEY (`executionId`) REFERENCES `SeoFixExecution`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFixVerification` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fixId` VARCHAR(191) NOT NULL,
  `executionId` VARCHAR(191) NOT NULL,
  `verificationStatus` VARCHAR(191) NOT NULL,
  `observedState` JSON NULL,
  `details` TEXT NULL,
  `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SeoFixVerification_executionId_key` (`executionId`),
  INDEX `SeoFixVerification_org_status_checked_idx` (`organizationId`,`verificationStatus`,`checkedAt` DESC),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixVerification_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixVerification_fixId_fkey` FOREIGN KEY (`fixId`) REFERENCES `SeoFix`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixVerification_executionId_fkey` FOREIGN KEY (`executionId`) REFERENCES `SeoFixExecution`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFixRollback` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fixId` VARCHAR(191) NOT NULL,
  `executionId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `initiatedById` VARCHAR(191) NOT NULL,
  `initiatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `result` JSON NULL,
  `errorMessage` TEXT NULL,
  UNIQUE INDEX `SeoFixRollback_executionId_key` (`executionId`),
  INDEX `SeoFixRollback_organizationId_status_initiatedAt_idx` (`organizationId`,`status`,`initiatedAt` DESC),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixRollback_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixRollback_fixId_fkey` FOREIGN KEY (`fixId`) REFERENCES `SeoFix`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixRollback_executionId_fkey` FOREIGN KEY (`executionId`) REFERENCES `SeoFixExecution`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoFixAuditLog` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `fixId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `action` VARCHAR(191) NOT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SeoFixAuditLog_organizationId_createdAt_idx` (`organizationId`,`createdAt` DESC),
  INDEX `SeoFixAuditLog_fixId_createdAt_idx` (`fixId`,`createdAt` DESC),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoFixAuditLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoFixAuditLog_fixId_fkey` FOREIGN KEY (`fixId`) REFERENCES `SeoFix`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
