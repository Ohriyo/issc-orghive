import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useFieldArray,
  useForm,
  useWatch,
  type UseFieldArrayReturn,
  type UseFormReturn,
} from 'react-hook-form';
import {
  ACTING_AS_HEADER,
  COVER_MAX_BYTES,
  COVER_MIN_WIDTH,
  dashboardResponseSchema,
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  LOGO_MIN_WIDTH,
  organizationProfileSchema,
  PROFILE_MAX_LINKS,
  PROFILE_MAX_OFFICERS,
  profileFieldsSchema,
  socialLinkOf,
  type OrganizationDetail,
  type OrganizationProfile,
  type ProfileFields,
  type ProfileFieldsInput,
} from '@orghive/shared';
import type { ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import {
  toOrganizationPage,
  type OrganizationPageModel,
} from '@/features/organizations/presenters/use-organization-page';
import { api, apiFetch, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useBackNavigation } from '@/navigation/use-back-navigation';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';

/** A picked image, shown in the preview until the profile is saved. */
export interface StagedImage {
  blob: Blob;
  url: string;
}

/** The logo the officer picked, waiting in the cropper. */
export interface PendingLogo {
  url: string;
  width: number;
  height: number;
}

export interface OwnOrg {
  id: string;
  slug: string;
  acronym: string;
  name: string;
}

export type ProfileEditorModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'no-organization' }
  | ReadyProfileEditor;

export interface ReadyProfileEditor {
  status: 'ready';
  org: OwnOrg;
  profile: OrganizationProfile;
  form: UseFormReturn<ProfileFieldsInput, unknown, ProfileFields>;
  officers: UseFieldArrayReturn<ProfileFieldsInput, 'officers'>;
  canAddOfficer: boolean;
  links: {
    values: string[];
    /** "Instagram", "TikTok"… for each typed link; null until it looks like one. */
    kinds: (string | null)[];
    canAdd: boolean;
    add: () => void;
    remove: (index: number) => void;
    change: (index: number, value: string) => void;
  };
  logo: {
    /** What the hexagon shows: the staged crop, else the saved logo. */
    src: string | null;
    staged: boolean;
    pending: PendingLogo | null;
    error: string | undefined;
    choose: (file: File) => void;
    /** From the cropper: the square to use. */
    accept: (blob: Blob) => void;
    cancel: () => void;
    revert: () => void;
  };
  cover: {
    src: string | null;
    staged: boolean;
    removed: boolean;
    error: string | undefined;
    choose: (file: File) => void;
    remove: () => void;
    revert: () => void;
  };
  actingAs: ActingAsModel;
  /** The public page as it will look once saved. */
  preview: OrganizationPageModel;
  publicHref: string;
  dirty: boolean;
  saving: boolean;
  saveError: string | undefined;
  save: () => void;
  leave: { asking: boolean; stay: () => void; go: () => void };
}

const FIVE_MINUTES = 5 * 60_000;
export const ACCEPTED_IMAGES = LOGO_MIME_TYPES.join(',');

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) {
    // "logo: The logo must be…" → "The logo must be…": the field is named in the sentence.
    return error.message.replace(/^[a-zA-Z.\d]+: /, '');
  }
  return 'Something went wrong on our side. Try again in a moment.';
}

/** The saved profile as the form holds it. */
export function toFormValues(profile: OrganizationProfile): ProfileFieldsInput {
  return {
    description: profile.description ?? '',
    mission: profile.mission ?? '',
    vision: profile.vision ?? '',
    contactEmail: profile.contactEmail ?? '',
    facebookUrl: profile.facebookUrl ?? '',
    links: profile.links.map((link) => link.url),
    officers: profile.officers,
  };
}

const blank = (value: string | null | undefined) => {
  const text = value?.trim() ?? '';
  return text === '' ? null : text;
};

/**
 * The public page from what is in the form right now, unvalidated: blank boxes read as
 * empty and a link that is not finished yet is left out. Hidden officers are left out,
 * exactly as the API leaves them out of the public page.
 */
export function toPreviewDetail(
  org: OwnOrg,
  profile: OrganizationProfile,
  values: ProfileFieldsInput,
  images: { logo: string | null; cover: string | null },
): OrganizationDetail {
  const isLink = (url: string) => /^https:\/\/[^\s/]+\.[^\s]+$/.test(url.trim());
  const facebook = blank(values.facebookUrl);
  const links = [
    ...(facebook && isLink(facebook) ? [facebook] : []),
    ...(values.links ?? []).map((url) => url.trim()).filter(isLink),
  ];
  return {
    id: org.id,
    type: profile.official.type,
    slug: profile.slug,
    acronym: profile.official.acronym,
    name: profile.official.name,
    description: blank(values.description),
    logoUrl: images.logo,
    logoSrcSet: null,
    parent: null,
    college: profile.official.college,
    mission: blank(values.mission),
    vision: blank(values.vision),
    contactEmail: blank(values.contactEmail),
    links: links.map((url) => ({ url, ...socialLinkOf(url) })),
    officers: (values.officers ?? [])
      .filter((o) => o.isPublic !== false && blank(o.position) && blank(o.name))
      .map((o) => ({ position: o.position.trim(), name: o.name.trim() })),
    coverUrl: images.cover,
    coverSrcSet: null,
  };
}

/** Width and height of an image file, or null when the browser cannot read it. */
async function measure(url: string): Promise<{ width: number; height: number } | null> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  }
}

function isAllowedImage(file: File): boolean {
  return (LOGO_MIME_TYPES as readonly string[]).includes(file.type);
}

/**
 * /dashboard/profile: the shared account edits its own organization's profile. The
 * official name, acronym, type and college are shown but belong to the ISSC. Everything
 * saves at once: the images first, then the fields, each with who is acting for the
 * account (the API audits every save). The preview is the real public page, from the form.
 */
export function useProfileEditor(actingAs: ActingAsModel): ProfileEditorModel {
  const queryClient = useQueryClient();
  const back = useBackNavigation({ path: '/dashboard', label: 'Dashboard' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [logo, setLogo] = useState<StagedImage | null>(null);
  const [pendingLogo, setPendingLogo] = useState<PendingLogo | null>(null);
  const [logoError, setLogoError] = useState<string>();
  const [cover, setCover] = useState<StagedImage | 'remove' | null>(null);
  const [coverError, setCoverError] = useState<string>();

  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get('/me/dashboard', { schema: dashboardResponseSchema }),
    staleTime: 60_000,
  });
  const own = dashboard.data?.organizations[0]?.organization;
  const profile = useQuery({
    queryKey: queryKeys.organizations.profile(own?.slug ?? ''),
    queryFn: () => api.get(`/organizations/${own!.slug}/profile`, { schema: organizationProfileSchema }),
    enabled: !!own,
    staleTime: FIVE_MINUTES,
  });

  const form = useForm<ProfileFieldsInput, unknown, ProfileFields>({
    resolver: zodResolver(profileFieldsSchema),
    defaultValues: {
      description: '',
      mission: '',
      vision: '',
      contactEmail: '',
      facebookUrl: '',
      links: [],
      officers: [],
    },
  });
  const officers = useFieldArray({ control: form.control, name: 'officers' });
  const values = useWatch({ control: form.control }) as ProfileFieldsInput;

  // Fill the form once the saved profile arrives (and again after a save elsewhere).
  const loaded = profile.data;
  useEffect(() => {
    if (loaded) form.reset(toFormValues(loaded));
  }, [loaded, form]);

  // Object URLs hold the picked files in memory until they are replaced or the page closes.
  useEffect(() => () => void (logo && URL.revokeObjectURL(logo.url)), [logo]);
  useEffect(
    () => () => void (cover && cover !== 'remove' && URL.revokeObjectURL(cover.url)),
    [cover],
  );

  const dirty = (form.formState.isDirty || logo !== null || cover !== null) && !saved;
  const guard = useUnsavedChangesGuard(dirty);

  const orgForPreview: OwnOrg | null = own
    ? { id: own.id, slug: own.slug, acronym: own.acronym, name: own.name }
    : null;
  const logoSrc = logo?.url ?? loaded?.logoUrl ?? null;
  const coverSrc = cover === 'remove' ? null : (cover?.url ?? loaded?.coverUrl ?? null);
  const preview = useMemo(
    () =>
      orgForPreview && loaded
        ? toOrganizationPage(
            toPreviewDetail(orgForPreview, loaded, values, { logo: logoSrc, cover: coverSrc }),
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- orgForPreview is rebuilt each render from `own`
    [own, loaded, values, logoSrc, coverSrc],
  );

  if (dashboard.isPending) return { status: 'loading' };
  if (dashboard.isError) return { status: 'error', retry: () => void dashboard.refetch() };
  if (!own || !orgForPreview) return { status: 'no-organization' };
  if (profile.isPending) return { status: 'loading' };
  if (profile.isError || !preview) {
    return { status: 'error', retry: () => void profile.refetch() };
  }
  const org = orgForPreview;
  const current = profile.data;
  const links = values.links ?? [];

  function setLinks(next: string[]) {
    form.setValue('links', next, { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  }

  async function chooseLogo(file: File) {
    setLogoError(undefined);
    if (!isAllowedImage(file)) return setLogoError('Choose a PNG, JPEG or WebP image.');
    if (file.size > LOGO_MAX_BYTES) return setLogoError('Choose an image of 2 MB or less.');
    const url = URL.createObjectURL(file);
    const size = await measure(url);
    if (!size) {
      URL.revokeObjectURL(url);
      return setLogoError('This image could not be read. Try another file.');
    }
    if (size.width < LOGO_MIN_WIDTH) {
      URL.revokeObjectURL(url);
      return setLogoError(`Choose an image at least ${LOGO_MIN_WIDTH} pixels wide.`);
    }
    setPendingLogo({ url, ...size });
  }

  async function chooseCover(file: File) {
    setCoverError(undefined);
    if (!isAllowedImage(file)) return setCoverError('Choose a PNG, JPEG or WebP image.');
    if (file.size > COVER_MAX_BYTES) return setCoverError('Choose an image of 5 MB or less.');
    const url = URL.createObjectURL(file);
    const size = await measure(url);
    if (!size || size.width < COVER_MIN_WIDTH) {
      URL.revokeObjectURL(url);
      return setCoverError(
        size
          ? `Choose an image at least ${COVER_MIN_WIDTH} pixels wide, so it stays sharp on large screens.`
          : 'This image could not be read. Try another file.',
      );
    }
    setCover({ blob: file, url });
  }

  function putImage(path: string, blob: Blob, name: string) {
    return apiFetch(path, {
      method: 'PUT',
      raw: blob,
      headers: { [ACTING_AS_HEADER]: encodeURIComponent(name) },
      schema: organizationProfileSchema,
    });
  }

  const submit = form.handleSubmit(async (fields) => {
    const name = actingAs.take();
    if (!name) {
      setSaveError('Enter your name in “Acting as” before saving.');
      return;
    }
    setSaveError(undefined);
    setSaving(true);
    const base = `/organizations/${org.slug}/profile`;
    try {
      if (logo) await putImage(`${base}/logo`, logo.blob, name);
      if (cover === 'remove') await api.delete(`${base}/cover`, { json: { actingAs: name } });
      else if (cover) await putImage(`${base}/cover`, cover.blob, name);
      await api.put(base, { ...fields, actingAs: name }, { schema: organizationProfileSchema });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.organizations.detail(org.slug) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.organizations.profile(org.slug) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.colleges.list }),
        queryClient.invalidateQueries({ queryKey: ['colleges'] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
      setSaved(true);
      guard.allowNextNavigation();
      back.finish('Profile saved. Your public page shows the changes now.');
    } catch (error) {
      setSaveError(errorMessage(error));
      // Whatever went through (an image) is saved; reload so the form starts from it.
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.profile(org.slug) });
    } finally {
      setSaving(false);
    }
  });

  return {
    status: 'ready',
    org,
    profile: current,
    form,
    officers,
    canAddOfficer: officers.fields.length < PROFILE_MAX_OFFICERS,
    links: {
      values: links,
      kinds: links.map((url) =>
        /^https:\/\/\S+\.\S+/.test(url.trim()) ? socialLinkOf(url.trim()).label : null,
      ),
      canAdd: links.length < PROFILE_MAX_LINKS,
      add: () => setLinks([...links, '']),
      remove: (index) => setLinks(links.filter((_, i) => i !== index)),
      change: (index, value) => setLinks(links.map((url, i) => (i === index ? value : url))),
    },
    logo: {
      src: logoSrc,
      staged: logo !== null,
      pending: pendingLogo,
      error: logoError,
      choose: (file) => void chooseLogo(file),
      accept: (blob) => {
        if (pendingLogo) URL.revokeObjectURL(pendingLogo.url);
        setPendingLogo(null);
        setLogo({ blob, url: URL.createObjectURL(blob) });
      },
      cancel: () => {
        if (pendingLogo) URL.revokeObjectURL(pendingLogo.url);
        setPendingLogo(null);
      },
      revert: () => setLogo(null),
    },
    cover: {
      src: coverSrc,
      staged: cover !== null && cover !== 'remove',
      removed: cover === 'remove',
      error: coverError,
      choose: (file) => void chooseCover(file),
      remove: () => setCover('remove'),
      revert: () => setCover(null),
    },
    actingAs,
    preview,
    publicHref: `/orgs/${org.slug}`,
    dirty,
    saving,
    saveError,
    save: () => void submit(),
    leave: {
      asking: guard.blocker.state === 'blocked',
      stay: () => guard.blocker.reset?.(),
      go: () => guard.blocker.proceed?.(),
    },
  };
}
