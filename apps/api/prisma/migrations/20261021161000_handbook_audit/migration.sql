-- The ISSC account made a Student Handbook edition the current one (audited).
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'handbook_current' AFTER 'appeal_submit';
