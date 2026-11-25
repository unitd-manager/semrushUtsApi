CREATE TABLE `SeoOpsProject` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `projectId` VARCHAR(191) NULL,
  `websiteId` VARCHAR(191) NULL,
  `clientId` VARCHAR(191) NULL,
  `managerId` VARCHAR(191) NULL,
  `startDate` DATE NULL,
  `targetDate` DATE NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'ACTIVE',
  `priority` VARCHAR(191) NOT NULL DEFAULT 'P2',
  `goals` JSON NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `SeoOpsProject_organizationId_status_updatedAt_idx` (`organizationId`, `status`, `updatedAt` DESC),
  INDEX `SeoOpsProject_projectId_status_idx` (`projectId`, `status`),
  INDEX `SeoOpsProject_websiteId_idx` (`websiteId`),
  INDEX `SeoOpsProject_clientId_idx` (`clientId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoOpsProject_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoOpsProject_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `SeoOpsProject_websiteId_fkey` FOREIGN KEY (`websiteId`) REFERENCES `Domain` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `SeoOpsProject_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `Lead` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTask` (
  `id` VARCHAR(191) NOT NULL,
  `organizationId` VARCHAR(191) NOT NULL,
  `seoProjectId` VARCHAR(191) NULL,
  `projectId` VARCHAR(191) NULL,
  `websiteId` VARCHAR(191) NULL,
  `clientId` VARCHAR(191) NULL,
  `parentTaskId` VARCHAR(191) NULL,
  `title` VARCHAR(191) NOT NULL,
  `description` TEXT NULL,
  `category` VARCHAR(191) NOT NULL DEFAULT 'CUSTOM',
  `priority` VARCHAR(191) NOT NULL DEFAULT 'P2',
  `severity` VARCHAR(191) NOT NULL DEFAULT 'MEDIUM',
  `status` VARCHAR(191) NOT NULL DEFAULT 'BACKLOG',
  `sourceModule` VARCHAR(191) NULL,
  `sourceEntityType` VARCHAR(191) NULL,
  `sourceEntityId` VARCHAR(191) NULL,
  `sourceEvidence` JSON NULL,
  `affectedUrls` JSON NULL,
  `targetKeywords` JSON NULL,
  `labels` JSON NULL,
  `acceptanceCriteria` JSON NULL,
  `estimatedMinutes` INTEGER NULL,
  `startDate` DATE NULL,
  `dueDate` DATE NULL,
  `completedAt` DATETIME(3) NULL,
  `verifiedAt` DATETIME(3) NULL,
  `assigneeId` VARCHAR(191) NULL,
  `reviewerId` VARCHAR(191) NULL,
  `createdById` VARCHAR(191) NOT NULL,
  `dedupeKey` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `SeoTask_dedupeKey_key` (`dedupeKey`),
  INDEX `SeoTask_organizationId_status_dueDate_idx` (`organizationId`, `status`, `dueDate`),
  INDEX `SeoTask_organizationId_assigneeId_status_dueDate_idx` (`organizationId`, `assigneeId`, `status`, `dueDate`),
  INDEX `SeoTask_seoProjectId_status_priority_idx` (`seoProjectId`, `status`, `priority`),
  INDEX `SeoTask_sourceModule_sourceEntityId_idx` (`sourceModule`, `sourceEntityId`),
  INDEX `SeoTask_parentTaskId_idx` (`parentTaskId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SeoTask_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoTask_seoProjectId_fkey` FOREIGN KEY (`seoProjectId`) REFERENCES `SeoOpsProject` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `SeoTask_parentTaskId_fkey` FOREIGN KEY (`parentTaskId`) REFERENCES `SeoTask` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskCollaborator` (
  `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL, `userId` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL DEFAULT 'WATCHER', `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SeoTaskCollaborator_taskId_userId_key` (`taskId`, `userId`), INDEX `SeoTaskCollaborator_userId_role_idx` (`userId`, `role`), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskCollaborator_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskComment` (
  `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL, `authorId` VARCHAR(191) NOT NULL,
  `body` TEXT NOT NULL, `visibility` VARCHAR(191) NOT NULL DEFAULT 'TEAM', `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SeoTaskComment_taskId_createdAt_idx` (`taskId`, `createdAt`), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskComment_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskDependency` (
  `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL, `dependsOnTaskId` VARCHAR(191) NOT NULL,
  `dependencyType` VARCHAR(191) NOT NULL DEFAULT 'BLOCKS', `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SeoTaskDependency_taskId_dependsOnTaskId_key` (`taskId`, `dependsOnTaskId`), INDEX `SeoTaskDependency_dependsOnTaskId_idx` (`dependsOnTaskId`), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskDependency_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoTaskDependency_dependsOnTaskId_fkey` FOREIGN KEY (`dependsOnTaskId`) REFERENCES `SeoTask` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskApproval` (
  `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL, `reviewerId` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL, `comments` TEXT NULL, `reviewedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SeoTaskApproval_taskId_reviewedAt_idx` (`taskId`, `reviewedAt` DESC), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskApproval_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskVerification` (
  `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL, `verificationMethod` VARCHAR(191) NOT NULL,
  `verificationStatus` VARCHAR(191) NOT NULL, `evidence` JSON NULL, `failureReason` TEXT NULL,
  `verifiedById` VARCHAR(191) NOT NULL, `verifiedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SeoTaskVerification_taskId_verifiedAt_idx` (`taskId`, `verifiedAt` DESC), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskVerification_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskActivity` (
  `id` VARCHAR(191) NOT NULL, `taskId` VARCHAR(191) NOT NULL, `actorId` VARCHAR(191) NULL,
  `action` VARCHAR(191) NOT NULL, `metadata` JSON NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `SeoTaskActivity_taskId_createdAt_idx` (`taskId`, `createdAt` DESC), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskActivity_taskId_fkey` FOREIGN KEY (`taskId`) REFERENCES `SeoTask` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskAutomationRule` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `name` VARCHAR(191) NOT NULL,
  `sourceModule` VARCHAR(191) NOT NULL, `minimumSeverity` VARCHAR(191) NOT NULL DEFAULT 'WARNING',
  `minimumAffectedUrls` INTEGER NOT NULL DEFAULT 1, `actionPriority` VARCHAR(191) NOT NULL DEFAULT 'P1',
  `assignToId` VARCHAR(191) NULL, `dueInDays` INTEGER NOT NULL DEFAULT 7, `enabled` BOOLEAN NOT NULL DEFAULT true,
  `createdById` VARCHAR(191) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  INDEX `SeoTaskAutomationRule_organizationId_enabled_sourceModule_idx` (`organizationId`, `enabled`, `sourceModule`), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskAutomationRule_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SeoTaskAutomationLog` (
  `id` VARCHAR(191) NOT NULL, `organizationId` VARCHAR(191) NOT NULL, `ruleId` VARCHAR(191) NOT NULL,
  `taskId` VARCHAR(191) NULL, `status` VARCHAR(191) NOT NULL, `message` TEXT NOT NULL,
  `dedupeKey` VARCHAR(191) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SeoTaskAutomationLog_dedupeKey_key` (`dedupeKey`), INDEX `SeoTaskAutomationLog_organizationId_createdAt_idx` (`organizationId`, `createdAt` DESC),
  INDEX `SeoTaskAutomationLog_ruleId_createdAt_idx` (`ruleId`, `createdAt` DESC), PRIMARY KEY (`id`),
  CONSTRAINT `SeoTaskAutomationLog_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SeoTaskAutomationLog_ruleId_fkey` FOREIGN KEY (`ruleId`) REFERENCES `SeoTaskAutomationRule` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
