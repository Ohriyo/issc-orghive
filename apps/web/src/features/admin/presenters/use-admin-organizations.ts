import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  adminCollegeSchema,
  adminOrganizationSchema,
  adminOrganizationTreeSchema,
  type AdminCollege,
  type AdminOrganization,
  type AdminOrganizationTree,
  type CreateCollegeRequest,
  type CreateOrganizationRequest,
  type UpdateCollegeRequest,
  type UpdateOrganizationRequest,
} from '@orghive/shared';
import { api, apiFetch, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

/** One line of the hierarchy table. Colleges group their CSC and SBOs below them. */
export interface HierarchyRow {
  id: string;
  kind: 'issc' | 'college' | 'csc' | 'sbo';
  /** 0 for the ISSC and colleges, 1 for a college's CSC and SBOs. */
  depth: 0 | 1;
  /** Acronym or college code. */
  label: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  /** Colleges have no status of their own. */
  active: boolean | null;
  documentCount: number | null;
  /** It has an active shared account; null for colleges. */
  hasAccount: boolean | null;
  /** Set where the row can move within its carousel (colleges, and SBOs in a college). */
  move: { up: (() => void) | null; down: (() => void) | null; position: number; of: number } | null;
  /** True for the last row of a college group, to end its tree guide. */
  lastInGroup: boolean;
  /** College rows: what can be added (a CSC until it has one; SBOs once it has a CSC). */
  adds: ('CSC' | 'SBO')[];
}

/** What the side sheet is editing; null when it is closed. */
export type Editing =
  | { kind: 'college'; college: AdminCollege | null }
  | {
      kind: 'organization';
      organization: AdminOrganization | null;
      /** For a new organization: where it goes and what it is. */
      collegeSlug?: string;
      type?: 'CSC' | 'SBO';
    }
  | null;

export type AdminOrganizationsState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | {
      status: 'ready';
      rows: HierarchyRow[];
      colleges: AdminCollege[];
      editing: Editing;
      openCollege: (slug: string | null) => void;
      openOrganization: (slug: string) => void;
      newOrganization: (collegeSlug: string, type: 'CSC' | 'SBO') => void;
      close: () => void;
      saveCollege: (slug: string | null, values: CreateCollegeRequest) => Promise<string | null>;
      saveOrganization: (
        slug: string | null,
        values: CreateOrganizationRequest,
      ) => Promise<string | null>;
      setActive: (slug: string, active: boolean) => void;
      uploadLogo: (slug: string, file: File) => Promise<string | null>;
      pending: boolean;
    };

/** Moves `slugs[index]` one place up or down. */
export function moved(slugs: string[], index: number, by: -1 | 1): string[] {
  const next = [...slugs];
  [next[index], next[index + by]] = [next[index + by]!, next[index]!];
  return next;
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

/** Flattens the tree into table rows, wiring each row's move buttons to `reorder`. */
export function toRows(
  tree: AdminOrganizationTree,
  reorder: {
    colleges: (slugs: string[]) => void;
    sbos: (collegeSlug: string, slugs: string[]) => void;
  },
): HierarchyRow[] {
  const rows: HierarchyRow[] = [];
  const org = (o: AdminOrganization, kind: HierarchyRow['kind'], depth: 0 | 1): HierarchyRow => ({
    id: `org:${o.slug}`,
    kind,
    depth,
    label: o.acronym,
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl,
    active: o.active,
    documentCount: o.documentCount,
    hasAccount: o.hasAccount,
    move: null,
    lastInGroup: false,
    adds: [],
  });
  if (tree.issc) rows.push(org(tree.issc, 'issc', 0));

  const collegeSlugs = tree.colleges.map((c) => c.slug);
  tree.colleges.forEach((college, i) => {
    rows.push({
      id: `college:${college.slug}`,
      kind: 'college',
      depth: 0,
      label: college.code,
      name: college.name,
      slug: college.slug,
      logoUrl: null,
      active: null,
      documentCount: null,
      hasAccount: null,
      move: {
        position: i + 1,
        of: collegeSlugs.length,
        up: i > 0 ? () => reorder.colleges(moved(collegeSlugs, i, -1)) : null,
        down:
          i < collegeSlugs.length - 1 ? () => reorder.colleges(moved(collegeSlugs, i, 1)) : null,
      },
      lastInGroup: !college.csc && college.sbos.length === 0,
      adds: college.csc ? ['SBO'] : ['CSC'],
    });
    const group: HierarchyRow[] = [];
    if (college.csc) group.push(org(college.csc, 'csc', 1));
    const sboSlugs = college.sbos.map((s) => s.slug);
    college.sbos.forEach((sbo, j) => {
      group.push({
        ...org(sbo, 'sbo', 1),
        move: {
          position: j + 1,
          of: sboSlugs.length,
          up: j > 0 ? () => reorder.sbos(college.slug, moved(sboSlugs, j, -1)) : null,
          down:
            j < sboSlugs.length - 1
              ? () => reorder.sbos(college.slug, moved(sboSlugs, j, 1))
              : null,
        },
      });
    });
    if (group.length > 0) group[group.length - 1]!.lastInGroup = true;
    rows.push(...group);
  });
  return rows;
}

/**
 * Presenter for /admin/organizations: the ISSC, colleges, CSCs and SBOs in carousel order,
 * with create and edit, logos, reordering and activation. Every change also refreshes the
 * public college and organization reads it affects.
 */
export function useAdminOrganizations(): AdminOrganizationsState {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing>(null);
  const tree = useQuery({
    queryKey: queryKeys.admin.organizations,
    queryFn: () => api.get('/admin/organizations', { schema: adminOrganizationTreeSchema }),
    staleTime: 60_000,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.organizations }),
      queryClient.invalidateQueries({ queryKey: ['colleges'] }),
      queryClient.invalidateQueries({ queryKey: ['organizations'] }),
    ]);

  const reorder = useMutation({
    mutationFn: (input: { path: string; slugs: string[] }) =>
      api.put(input.path, { slugs: input.slugs }),
    onError: (error) => toast.error(`The order was not saved. ${messageOf(error)}`),
    onSettled: refresh,
  });

  const activation = useMutation({
    mutationFn: (input: { slug: string; active: boolean }) =>
      api.put(
        `/admin/organizations/${input.slug}/active`,
        { active: input.active },
        { schema: adminOrganizationSchema },
      ),
    // Reversible, so no confirmation first: the toast offers Undo instead.
    onSuccess: (org) =>
      toast.success(
        org.active
          ? `${org.acronym} is active again.`
          : `${org.acronym} is inactive: hidden from browsing, no uploads or new projects.`,
        {
          action: {
            label: 'Undo',
            onClick: () => activation.mutate({ slug: org.slug, active: !org.active }),
          },
        },
      ),
    onError: (error) => toast.error(messageOf(error)),
    onSettled: refresh,
  });

  if (tree.isPending) return { status: 'loading' };
  if (tree.isError) return { status: 'error', retry: () => void tree.refetch() };
  const data = tree.data;
  const findOrg = (slug: string) =>
    [data.issc, ...data.colleges.flatMap((c) => [c.csc, ...c.sbos])].find(
      (o): o is AdminOrganization => o?.slug === slug,
    ) ?? null;

  /** Runs a save; returns an error message for the form, or null once saved and closed. */
  async function attempt(run: () => Promise<unknown>, done: string): Promise<string | null> {
    try {
      await run();
      await refresh();
      toast.success(done);
      setEditing(null);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  }

  return {
    status: 'ready',
    rows: toRows(data, {
      colleges: (slugs) => reorder.mutate({ path: '/admin/colleges/order', slugs }),
      sbos: (collegeSlug, slugs) =>
        reorder.mutate({ path: `/admin/colleges/${collegeSlug}/organizations/order`, slugs }),
    }),
    colleges: data.colleges,
    editing,
    openCollege: (slug) =>
      setEditing({
        kind: 'college',
        college: slug ? (data.colleges.find((c) => c.slug === slug) ?? null) : null,
      }),
    openOrganization: (slug) => setEditing({ kind: 'organization', organization: findOrg(slug) }),
    newOrganization: (collegeSlug, type) =>
      setEditing({ kind: 'organization', organization: null, collegeSlug, type }),
    close: () => setEditing(null),
    saveCollege: (slug, values) => {
      const { slug: _slug, ...patch } = values;
      return attempt(
        () =>
          slug
            ? api.patch(`/admin/colleges/${slug}`, patch satisfies UpdateCollegeRequest, {
                schema: adminCollegeSchema,
              })
            : api.post('/admin/colleges', values, { schema: adminCollegeSchema }),
        slug ? `${values.code} saved.` : `${values.code} added. It is last in the carousel.`,
      );
    },
    saveOrganization: (slug, values) => {
      const patch: UpdateOrganizationRequest = {
        acronym: values.acronym,
        name: values.name,
        description: values.description ?? null,
      };
      return attempt(
        () =>
          slug
            ? api.patch(`/admin/organizations/${slug}`, patch, { schema: adminOrganizationSchema })
            : api.post('/admin/organizations', values, { schema: adminOrganizationSchema }),
        slug ? `${values.acronym} saved.` : `${values.acronym} added.`,
      );
    },
    setActive: (slug, active) => activation.mutate({ slug, active }),
    uploadLogo: async (slug, file) => {
      try {
        await apiFetch(`/admin/organizations/${slug}/logo`, {
          method: 'PUT',
          raw: file,
          schema: adminOrganizationSchema,
        });
        await refresh();
        toast.success('Logo updated.');
        return null;
      } catch (error) {
        return messageOf(error);
      }
    },
    pending: reorder.isPending || activation.isPending,
  };
}
