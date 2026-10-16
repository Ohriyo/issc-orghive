import { z } from 'zod';

/** The three organization levels. All live in one `organizations` table. */
export const ORGANIZATION_TYPES = ['ISSC', 'CSC', 'SBO'] as const;
export const organizationTypeSchema = z.enum(ORGANIZATION_TYPES);
export type OrganizationType = z.infer<typeof organizationTypeSchema>;

/** Roles are per organization (memberships). `admin` on the ISSC is system-wide. */
export const MEMBERSHIP_ROLES = ['officer', 'adviser', 'admin'] as const;
export const membershipRoleSchema = z.enum(MEMBERSHIP_ROLES);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

/** Lowercase words joined by hyphens, e.g. "csc-cea", "icpep-se". */
export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens');
