import type { AccountRepository } from '#src/repositories/account.repository';
import type { OrganizationRepository } from '#src/repositories/organization.repository';
import { appealDeciderOf, type AppellantOrg } from './appeal-rules';

export interface RecipientsDeps {
  accounts: Pick<AccountRepository, 'findOrganizationAccount'>;
  organizations: Pick<OrganizationRepository, 'listByType'>;
}

/** Who is told about what: an organization's shared account, and whoever decides its appeals. */
export function createRecipients({ accounts, organizations }: RecipientsDeps) {
  async function accountOf(organizationId: string): Promise<string[]> {
    const account = await accounts.findOrganizationAccount(organizationId);
    return account ? [account.id] : [];
  }

  async function isscAccount(): Promise<string[]> {
    const [issc] = await organizations.listByType('ISSC');
    return issc ? accountOf(issc.id) : [];
  }

  return {
    /** The organization's active account (none while it has no account, or it is locked). */
    officersOf: accountOf,

    /**
     * Who decides `appellant`'s appeals now (appeal-rules.ts): the parent organization's
     * account, or the ISSC account while that seat is vacant. Nobody for the ISSC itself.
     */
    async decidersOf(appellant: AppellantOrg): Promise<{ userIds: string[]; seatFilled: boolean }> {
      const decider = appealDeciderOf(appellant);
      if (!decider) return { userIds: [], seatFilled: false };
      const seated = await accountOf(decider.organizationId);
      if (seated.length > 0) return { userIds: seated, seatFilled: true };
      return { userIds: await isscAccount(), seatFilled: false };
    },
  };
}

export type Recipients = ReturnType<typeof createRecipients>;
