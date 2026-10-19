import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  accountEmailSchema,
  adminOrganizationSchema,
  adminOrganizationTreeSchema,
  createAccountResponseSchema,
  createOrganizationRequestSchema,
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  officerInChargeInputSchema,
  type AdminOrganization,
  type CreateAccountRequest,
  type CreateAccountResponse,
} from '@orghive/shared';
import { api, apiFetch } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatDate, messageOf } from './system-format';
import { useAccountRequest } from './use-account-requests';

/*
 * The form's own shape: which organization (by type and college, existing or new), then
 * the sign-in email and the officer in charge. Every rule comes from the shared schemas; the
 * request is assembled from it on submit.
 */
const newOrganization = createOrganizationRequestSchema.pick({
  slug: true,
  acronym: true,
  name: true,
  description: true,
});

export const createAccountFormSchema = z
  .object({
    type: z.enum(['ISSC', 'CSC', 'SBO'], { error: 'Choose the organization type' }),
    collegeSlug: z.string(),
    mode: z.enum(['existing', 'new']),
    existingSlug: z.string(),
    newOrg: z.object({
      slug: z.string(),
      acronym: z.string(),
      name: z.string(),
      description: z.string(),
    }),
    email: accountEmailSchema,
    officerInCharge: officerInChargeInputSchema,
    termEnd: z.string(),
  })
  .superRefine((form, ctx) => {
    if (form.type !== 'ISSC' && !form.collegeSlug) {
      ctx.addIssue({ code: 'custom', path: ['collegeSlug'], message: 'Choose the college' });
    }
    if (form.mode === 'existing' || form.type === 'ISSC') {
      if (!form.existingSlug) {
        ctx.addIssue({
          code: 'custom',
          path: ['existingSlug'],
          message: 'Choose the organization',
        });
      }
      return;
    }
    const parsed = newOrganization.safeParse({
      ...form.newOrg,
      description: form.newOrg.description || undefined,
    });
    for (const issue of parsed.error?.issues ?? []) {
      ctx.addIssue({ code: 'custom', path: ['newOrg', ...issue.path], message: issue.message });
    }
  });
export type CreateAccountForm = z.input<typeof createAccountFormSchema>;

/** "JPICE" → "jpice"; "ICpEP.SE" → "icpep-se". A suggestion; the field stays editable. */
export function slugFromAcronym(acronym: string): string {
  return acronym
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toCreateRequest(
  form: z.output<typeof createAccountFormSchema>,
  requestId: string | null = null,
): CreateAccountRequest {
  const organization: CreateAccountRequest['organization'] =
    form.mode === 'new' && form.type !== 'ISSC'
      ? {
          kind: 'new',
          type: form.type,
          collegeSlug: form.collegeSlug,
          slug: form.newOrg.slug,
          acronym: form.newOrg.acronym.trim(),
          name: form.newOrg.name.trim(),
          ...(form.newOrg.description.trim() && { description: form.newOrg.description.trim() }),
        }
      : { kind: 'existing', slug: form.existingSlug };
  return {
    organization,
    email: form.email,
    officerInCharge: form.officerInCharge,
    termEnd: form.termEnd || null,
    ...(requestId && { requestId }),
  };
}

export interface OrganizationChoice {
  value: string;
  label: string;
}

/** What the screen shows once the account exists. */
export type CreatedResult = {
  accountHref: string;
  acronym: string;
  email: string;
  /** The ISSC account's own password: shown here once, never again. */
  temporaryPassword: string | null;
  /** Otherwise, until when the ISSC account can reveal it. */
  revealUntil: string | null;
  logoError: string | null;
};

const withoutAccount = (orgs: (AdminOrganization | null)[]) =>
  orgs.filter((o): o is AdminOrganization => o !== null && !o.hasAccount);

/**
 * /system/users/new. Existing organizations without an account are offered; a new CSC or SBO
 * can be made with the account (it shows in its college's lists at once). The temporary
 * password goes to the ISSC account's one-time Reveal; only the ISSC's own is shown here.
 */
export function useCreateAccount() {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<CreatedResult | null>(null);
  const [logo, setLogoState] = useState<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  // From the ISSC's account request (/system/account-requests): the form starts filled in.
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const request = useAccountRequest(requestId);
  const openRequest = request.data?.status === 'requested' ? request.data : null;

  const tree = useQuery({
    queryKey: queryKeys.system.organizations,
    queryFn: () => api.get('/system/organizations', { schema: adminOrganizationTreeSchema }),
    staleTime: 30_000,
  });

  const form = useForm<CreateAccountForm, unknown, z.output<typeof createAccountFormSchema>>({
    resolver: zodResolver(createAccountFormSchema),
    // An open request fills the form in once it loads (React Hook Form resets to `values`).
    values: openRequest
      ? {
          type: openRequest.organization.type,
          collegeSlug: openRequest.organization.collegeSlug ?? '',
          mode: 'existing',
          existingSlug: openRequest.organization.slug,
          newOrg: { slug: '', acronym: '', name: '', description: '' },
          email: openRequest.accountEmail,
          officerInCharge: openRequest.officerInCharge,
          termEnd: '',
        }
      : undefined,
    resetOptions: { keepDirtyValues: true },
    defaultValues: {
      type: 'SBO',
      collegeSlug: '',
      mode: 'existing',
      existingSlug: '',
      newOrg: { slug: '', acronym: '', name: '', description: '' },
      email: '',
      officerInCharge: { name: '', position: '', email: '' },
      termEnd: '',
    },
  });

  const create = useMutation({
    mutationFn: async (values: z.output<typeof createAccountFormSchema>) => {
      const response: CreateAccountResponse = await api.post(
        '/system/accounts',
        toCreateRequest(
          values,
          requestId && request.data?.status === 'requested' ? requestId : null,
        ),
        { schema: createAccountResponseSchema },
      );
      let failedLogo: string | null = null;
      const slug = response.account.organization?.slug;
      if (logo && values.mode === 'new' && slug) {
        try {
          await apiFetch(`/system/organizations/${slug}/logo`, {
            method: 'PUT',
            raw: logo,
            schema: adminOrganizationSchema,
          });
        } catch (error) {
          failedLogo = `The account was created, but the logo was not saved: ${messageOf(error)}`;
        }
      }
      return { response, failedLogo };
    },
    onSuccess: ({ response, failedLogo }) => {
      const { account, delivery } = response;
      setResult({
        accountHref: `/system/users/${account.id}`,
        acronym: account.organization?.acronym ?? account.name,
        email: account.email,
        temporaryPassword: delivery.kind === 'shown_once' ? delivery.temporaryPassword : null,
        revealUntil: delivery.kind === 'reveal' ? formatDate(delivery.expiresAt) : null,
        logoError: failedLogo,
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.system.all });
    },
  });

  const values = useWatch({ control: form.control }) as CreateAccountForm;
  const data = tree.data;
  const colleges = (data?.colleges ?? []).map((c) => ({
    value: c.slug,
    label: `${c.code} · ${c.name}`,
  }));
  const college = data?.colleges.find((c) => c.slug === values.collegeSlug);
  const existingChoices: OrganizationChoice[] =
    values.type === 'ISSC'
      ? withoutAccount([data?.issc ?? null]).map((o) => ({ value: o.slug, label: o.name }))
      : values.type === 'CSC'
        ? withoutAccount([college?.csc ?? null]).map((o) => ({ value: o.slug, label: o.name }))
        : withoutAccount(college?.sbos ?? []).map((o) => ({
            value: o.slug,
            label: `${o.acronym} · ${o.name}`,
          }));
  // A college has one CSC: a new one can be made only while it has none.
  const canCreateNew =
    values.type === 'SBO' || (values.type === 'CSC' && !!college && college.csc === null);

  const fromRequest = request.data
    ? {
        organization: request.data.organization.acronym,
        note: request.data.note,
        requestedBy: request.data.requestedBy?.name ?? null,
        stillOpen: request.data.status === 'requested',
      }
    : null;

  return {
    fromRequest,
    tree: tree.isPending
      ? ({ status: 'loading' } as const)
      : tree.isError
        ? ({ status: 'error', retry: () => void tree.refetch() } as const)
        : ({ status: 'ready' } as const),
    form,
    colleges,
    existingChoices,
    /** Controlled: its options load after the form may be filled in from a request. */
    existingSlug: values.existingSlug ?? '',
    canCreateNew,
    showCollege: values.type !== 'ISSC',
    mode: canCreateNew ? values.mode : 'existing',
    /** Fills the slug from the acronym while the slug has not been edited by hand. */
    suggestSlug: (acronym: string) => {
      const current = form.getValues('newOrg.slug');
      const previous = slugFromAcronym(form.getValues('newOrg.acronym'));
      if (!current || current === previous) {
        form.setValue('newOrg.slug', slugFromAcronym(acronym));
      }
    },
    logo: {
      file: logo,
      error: logoError,
      choose: (file: File | null) => {
        if (file && (!LOGO_MIME_TYPES.includes(file.type as never) || file.size > LOGO_MAX_BYTES)) {
          setLogoError('Use a PNG, JPEG or WebP image of 2 MB or less.');
          setLogoState(null);
          return;
        }
        setLogoError(null);
        setLogoState(file);
      },
    },
    onSubmit: form.handleSubmit((submitted) => {
      const effective = canCreateNew ? submitted : { ...submitted, mode: 'existing' as const };
      create.mutate(effective);
    }),
    isSubmitting: create.isPending,
    submitError: create.error ? messageOf(create.error) : null,
    result,
    startOver: () => {
      setResult(null);
      setLogoState(null);
      create.reset();
      form.reset();
    },
  };
}

export type CreateAccountModel = ReturnType<typeof useCreateAccount>;
