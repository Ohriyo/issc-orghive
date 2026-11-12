-- AlterEnum: the /system tools (job queues, cache, email test, audit export).
ALTER TYPE "AuditAction" ADD VALUE 'queue_job_retry';
ALTER TYPE "AuditAction" ADD VALUE 'queue_job_remove';
ALTER TYPE "AuditAction" ADD VALUE 'queue_pause';
ALTER TYPE "AuditAction" ADD VALUE 'queue_resume';
ALTER TYPE "AuditAction" ADD VALUE 'cache_flush';
ALTER TYPE "AuditAction" ADD VALUE 'email_test';
ALTER TYPE "AuditAction" ADD VALUE 'audit_export';
