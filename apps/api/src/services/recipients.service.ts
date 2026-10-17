import type { MembershipRepository } from '#src/repositories/membership.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import { appealDeciderOf, holdsDecidingSeat, type AppellantOrg } from './appeal-rules';

export interface RecipientsDeps {
  memberships: Pick<MembershipRepository, 'findActiveHolders'>;
  organizations: Pick<OrganizationRepository, 'listByType'>;
  now?: () => Date;
}

const unique = (ids: string[]) => [...new Set(ids)];

/** Who is told about what: an organization's officers, and whoever decides its appeals. */
export function createRecipients({
  memberships,
  organizations,
  now = () => new Date(),
}: RecipientsDeps) {
  async function isscAdmins(): Promise<string[]> {
    const [issc] = await organizations.listByType('ISSC');
    if (!issc) return [];
    const holders = await memberships.findActiveHolders(issc.id, now());
    return unique(holders.filter((h) => h.role === 'admin').map((h) => h.user.id));
  }

  return {
    /** The organization's active officers. */
    async officersOf(organizationId: string): Promise<string[]> {
      const holders = await memberships.findActiveHolders(organizationId, now());
      return unique(holders.filter((h) => h.role === 'officer').map((h) => h.user.id));
    },

    /**
     * Who decides `appellant`'s appeals now (appeal-rules.ts): the seat holder, or the ISSC
     * admins while the seat is vacant.
     */
    async decidersOf(appellant: AppellantOrg): Promise<{ userIds: string[]; seatFilled: boolean }> {
      const decider = appealDeciderOf(appellant);
      const deciderType = appellant.type === 'SBO' ? 'CSC' : 'ISSC';
      const holders = await memberships.findActiveHolders(decider.organizationId, now());
      const seated = holders.filter((h) =>
        holdsDecidingSeat(appellant, {
          role: h.role,
          isHead: h.isHead,
          organization: { id: decider.organizationId, type: deciderType },
        }),
      );
      if (seated.length > 0) {
        return { userIds: unique(seated.map((h) => h.user.id)), seatFilled: true };
      }
      return { userIds: await isscAdmins(), seatFilled: false };
    },
  };
}

export type Recipients = ReturnType<typeof createRecipients>;
