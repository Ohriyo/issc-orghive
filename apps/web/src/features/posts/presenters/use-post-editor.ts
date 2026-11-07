import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ACTING_AS_HEADER,
  createPostRequestSchema,
  LOGO_MIME_TYPES,
  managedPostSchema,
  POST_GALLERY_MAX,
  POST_IMAGE_MAX_BYTES,
  POST_IMAGE_MIN_WIDTH,
  publishPostRequestSchema,
  updatePostRequestSchema,
  uploadedPostImageSchema,
  type ManagedPost,
  type OrgPostStatus,
  type OrgPostType,
  type PostSaveAction,
} from '@orghive/shared';
import { readActingAs, rememberActingAs } from '@/features/auth/presenters/use-acting-as';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api, apiFetch, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';

/** An image in the form: uploaded already, with the alt text the officer is writing. */
export interface EditorImage {
  key: string;
  widths: number[];
  url: string;
  alt: string;
}

export interface PostFormValues {
  type: OrgPostType;
  title: string;
  summary: string;
  body: string;
  eventDate: string;
  externalLink: string;
  cover: EditorImage | null;
  gallery: EditorImage[];
  /** A Manila wall-clock time, as a datetime-local input gives it. */
  publishAt: string;
  actingAs: string;
}

export type PostEditorState =
  | { status: 'loading' }
  | { status: 'no-organization' }
  | { status: 'not-found' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      isNew: boolean;
      /** The saved state of an existing post (drafts publish; live posts only save). */
      current: OrgPostStatus | null;
      org: { slug: string; acronym: string };
      form: UseFormReturn<PostFormValues>;
      save: (action: PostSaveAction) => void;
      saving: boolean;
      saveError: string | undefined;
      uploadCover: (file: File) => void;
      addGalleryImages: (files: File[]) => void;
      uploading: boolean;
      uploadError: string | undefined;
      galleryFull: boolean;
      leave: { asking: boolean; stay: () => void; go: () => void };
    };

const MANILA_OFFSET_MS = 8 * 3_600_000;

/** An instant as the datetime-local value of the same Manila wall-clock time. */
export function toManilaLocal(iso: string | null): string {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 16);
}

/** A datetime-local value, read as Manila time, as an ISO instant with its offset. */
export function fromManilaLocal(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00+08:00` : null;
}

function valuesOf(post: ManagedPost | null, actingAs: string): PostFormValues {
  return {
    type: post?.type ?? 'UPDATE',
    title: post?.title ?? '',
    summary: post?.summary ?? '',
    body: post?.body ?? '',
    eventDate: post?.eventDate ?? '',
    externalLink: post?.externalLink ?? '',
    cover: post?.cover ? { ...post.cover, widths: [...post.cover.widths] } : null,
    gallery: post?.gallery.map((g) => ({ ...g, widths: [...g.widths] })) ?? [],
    publishAt: toManilaLocal(post?.status === 'SCHEDULED' ? post.publishAt : null),
    actingAs,
  };
}

/** The request body from the form: blank optional fields become null. */
export function bodyOf(values: PostFormValues) {
  const image = (img: EditorImage) => ({ key: img.key, widths: img.widths, alt: img.alt });
  return {
    type: values.type,
    title: values.title,
    summary: values.summary,
    body: values.body,
    eventDate: values.eventDate || null,
    externalLink: values.externalLink.trim() || null,
    cover: values.cover ? image(values.cover) : null,
    gallery: values.gallery.map(image),
    actingAs: values.actingAs,
  };
}

const FIELD_OF: Record<string, keyof PostFormValues> = {
  cover: 'cover',
  gallery: 'gallery',
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/**
 * Presenter for /dashboard/posts/new and /dashboard/posts/:id. Validation is the shared
 * schema's (createPostRequestSchema / updatePostRequestSchema), run on save. Images are
 * uploaded as soon as they are picked (the API scans and converts them) and each needs alt
 * text. A save keeps it a draft, publishes it now, or schedules it at a Manila time.
 */
export function usePostEditor(postId: string | null): PostEditorState {
  const { user } = useAuth();
  const org = user?.organization ?? null;
  const slug = org?.slug ?? '';
  const isNew = postId === null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [saveError, setSaveError] = useState<string>();
  const [uploadError, setUploadError] = useState<string>();

  const existing = useQuery({
    queryKey: queryKeys.posts.managed(slug, postId ?? 'new'),
    queryFn: () =>
      api.get(`/organizations/${slug}/manage/posts/${postId}`, { schema: managedPostSchema }),
    enabled: Boolean(org) && !isNew,
  });
  const form = useForm<PostFormValues>({
    defaultValues: valuesOf(null, readActingAs(user?.id)),
  });
  const gallery = useWatch({ control: form.control, name: 'gallery' });
  useEffect(() => {
    if (existing.data) form.reset(valuesOf(existing.data, readActingAs(user?.id)));
  }, [existing.data, form, user?.id]);

  const save = useMutation({
    mutationFn: async ({ values, action }: { values: PostFormValues; action: PostSaveAction }) => {
      const body = bodyOf(values);
      const publishAt = action === 'schedule' ? fromManilaLocal(values.publishAt) : null;
      if (isNew) {
        const request = createPostRequestSchema.parse({ ...body, action, publishAt });
        return api.post(`/organizations/${slug}/posts`, request, { schema: managedPostSchema });
      }
      const { type: _type, ...rest } = body;
      const saved = await api.patch(
        `/organizations/${slug}/posts/${postId}`,
        updatePostRequestSchema.parse(rest),
        { schema: managedPostSchema },
      );
      if (action === 'draft' || saved.status === 'PUBLISHED') return saved;
      return api.post(
        `/organizations/${slug}/posts/${postId}/publish`,
        publishPostRequestSchema.parse({ actingAs: body.actingAs, publishAt }),
        { schema: managedPostSchema },
      );
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const name = form.getValues('actingAs').trim();
      return apiFetch(`/organizations/${slug}/post-images`, {
        method: 'POST',
        raw: file,
        headers: { [ACTING_AS_HEADER]: encodeURIComponent(name) },
        schema: uploadedPostImageSchema,
      });
    },
  });
  const guard = useUnsavedChangesGuard(form.formState.isDirty && !save.isSuccess);

  if (!org) return { status: 'no-organization' };
  if (existing.error instanceof ApiError && [400, 404].includes(existing.error.status)) {
    return { status: 'not-found' };
  }
  if (existing.isError) return { status: 'error', retry: () => void existing.refetch() };
  if (!isNew && !existing.data) return { status: 'loading' };

  /** Uploads need "Acting as" first: it is saved with the image. */
  const canUpload = (file: File): boolean => {
    setUploadError(undefined);
    if (!form.getValues('actingAs').trim()) {
      form.setError('actingAs', { message: 'Enter your name before adding images' });
      return false;
    }
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
      setUploadError(`${file.name}: use a PNG, JPEG or WebP image`);
      return false;
    }
    if (file.size > POST_IMAGE_MAX_BYTES) {
      setUploadError(`${file.name}: keep images under 5 MB`);
      return false;
    }
    return true;
  };

  const uploadOne = async (file: File): Promise<EditorImage | null> => {
    if (!canUpload(file)) return null;
    try {
      const image = await upload.mutateAsync(file);
      rememberActingAs(user?.id, form.getValues('actingAs').trim());
      return { key: image.key, widths: image.widths, url: image.url, alt: '' };
    } catch (error) {
      setUploadError(`${file.name}: ${errorMessage(error)}`);
      return null;
    }
  };

  const submit = (action: PostSaveAction) =>
    void form.handleSubmit(async (values) => {
      setSaveError(undefined);
      // The shared rules, checked here so each field shows its own message.
      const publishAt = action === 'schedule' ? fromManilaLocal(values.publishAt) : null;
      const check = createPostRequestSchema.safeParse({ ...bodyOf(values), action, publishAt });
      if (!check.success) {
        for (const issue of check.error.issues) {
          const [first, index] = issue.path;
          const field =
            first === 'publishAt'
              ? 'publishAt'
              : (FIELD_OF[String(first)] ?? (first as keyof PostFormValues));
          const name = (
            first === 'gallery' && typeof index === 'number' ? `gallery.${index}.alt` : field
          ) as never;
          form.setError(name, { message: issue.message });
        }
        return;
      }
      try {
        const saved = await save.mutateAsync({ values, action });
        rememberActingAs(user?.id, values.actingAs.trim());
        await queryClient.invalidateQueries({ queryKey: queryKeys.posts.all });
        guard.allowNextNavigation();
        toast.success(
          saved.status === 'SCHEDULED'
            ? 'Scheduled. It goes live at the time you chose.'
            : saved.status === 'PUBLISHED'
              ? 'Published on your page.'
              : 'Draft saved. Only your account sees it.',
        );
        void navigate('/dashboard/posts', { replace: true });
      } catch (error) {
        setSaveError(errorMessage(error));
      }
    })();

  return {
    status: 'ready',
    isNew,
    current: existing.data?.status ?? null,
    org: { slug: org.slug, acronym: org.acronym },
    form,
    save: submit,
    saving: form.formState.isSubmitting,
    saveError,
    uploadCover: (file) =>
      void uploadOne(file).then((image) => {
        if (image) form.setValue('cover', image, { shouldDirty: true });
      }),
    addGalleryImages: (files) =>
      void (async () => {
        const room = POST_GALLERY_MAX - form.getValues('gallery').length;
        for (const file of files.slice(0, room)) {
          const image = await uploadOne(file);
          if (image) {
            form.setValue('gallery', [...form.getValues('gallery'), image], { shouldDirty: true });
          }
        }
        if (files.length > room) setUploadError(`Add up to ${POST_GALLERY_MAX} gallery images`);
      })(),
    uploading: upload.isPending,
    uploadError,
    galleryFull: gallery.length >= POST_GALLERY_MAX,
    leave: {
      asking: guard.blocker.state === 'blocked',
      stay: () => guard.blocker.reset?.(),
      go: () => guard.blocker.proceed?.(),
    },
  };
}

/** Shown under the image fields. */
export const IMAGE_HINT = `PNG, JPEG or WebP, at least ${POST_IMAGE_MIN_WIDTH} pixels wide, up to 5 MB. Describe each image for people who cannot see it.`;
