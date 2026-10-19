-- Phase D (docs/DOMAIN_RULES.md, "Accounts"): the end of term is audited under one run id.
ALTER TYPE "AuditAction" ADD VALUE 'end_of_term';
