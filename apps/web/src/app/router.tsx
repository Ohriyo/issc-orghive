import { createBrowserRouter, Navigate, type RouteObject } from 'react-router';
import { AppShell } from './app-shell';
import { NotFoundPage, RouteErrorPage } from './route-error-page';
import { HomePage } from '@/features/home/home-page';

/**
 * Every page renders inside AppShell (header, back button, breadcrumbs, toasts). Errors
 * are caught by the pathless route below it, so even an error page keeps the header; the
 * root errorElement is only the last resort if the shell itself fails.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorPage />,
    children: [{ errorElement: <RouteErrorPage />, children: pages() }],
  },
];

function pages(): RouteObject[] {
  return [
    { index: true, element: <HomePage /> },
    {
      path: 'colleges',
      lazy: async () => ({
        Component: (await import('@/features/colleges/college-carousel-page')).CollegeCarouselPage,
      }),
    },
    {
      path: 'colleges/:slug',
      lazy: async () => ({
        Component: (await import('@/features/colleges/college-page')).CollegePage,
      }),
    },
    {
      path: 'colleges/:slug/organizations',
      lazy: async () => ({
        Component: (await import('@/features/colleges/sbo-carousel-page')).SboCarouselPage,
      }),
    },
    {
      path: 'orgs/:slug',
      lazy: async () => ({
        Component: (await import('@/features/organizations/organization-page')).OrganizationPage,
      }),
    },
    {
      path: 'orgs/:slug/paperworks',
      lazy: async () => ({
        Component: (await import('@/features/paperworks/paperworks-page')).PaperworksPage,
      }),
    },
    // A short alias for the upload screen.
    {
      path: 'orgs/:slug/upload',
      lazy: async () => ({
        Component: (await import('@/features/uploads/upload-page')).UploadAliasRedirect,
      }),
    },
    {
      path: 'orgs/:slug/paperworks/upload',
      lazy: async () => ({
        Component: (await import('@/features/uploads/upload-page')).UploadPage,
      }),
    },
    {
      path: 'documents/:id',
      lazy: async () => ({
        Component: (await import('@/features/documents/document-page')).DocumentPage,
      }),
    },
    {
      path: 'organizations/:slug/*',
      lazy: async () => ({
        Component: (await import('@/features/organizations/organization-page'))
          .LegacyOrganizationRedirect,
      }),
    },
    ...dashboardRoutes(),
    ...authRoutes(),
    ...devRoutes(),
    { path: '*', element: <NotFoundPage /> },
  ];
}

const authPages = () => import('@/features/auth/auth-pages');

function authRoutes(): RouteObject[] {
  return [
    { path: 'login', lazy: async () => ({ Component: (await authPages()).LoginPage }) },
    {
      path: 'forgot-password',
      lazy: async () => ({ Component: (await authPages()).ForgotPasswordPage }),
    },
    {
      path: 'reset-password',
      lazy: async () => ({ Component: (await authPages()).ResetPasswordPage }),
    },
    {
      path: 'change-password',
      lazy: async () => ({ Component: (await authPages()).ChangePasswordPage }),
    },
    // The old signed-in landing page; its actions now live in the header's user menu.
    { path: 'account', element: <Navigate to="/dashboard" replace /> },
  ];
}

const comingSoon = () => import('@/features/dashboard/coming-soon-page');

function dashboardRoutes(): RouteObject[] {
  return [
    {
      path: 'dashboard',
      lazy: async () => ({
        Component: (await import('@/features/dashboard/dashboard-page')).DashboardPage,
      }),
    },
    {
      path: 'dashboard/documents',
      lazy: async () => ({
        Component: (await import('@/features/dashboard/my-documents-page')).MyDocumentsPage,
      }),
    },
    {
      path: 'dashboard/projects',
      lazy: async () => ({
        Component: (await import('@/features/projects/projects-page')).ProjectsPage,
      }),
    },
    {
      path: 'dashboard/projects/new',
      lazy: async () => ({
        Component: (await import('@/features/projects/new-project-page')).NewProjectPage,
      }),
    },
    {
      path: 'dashboard/appeals',
      lazy: async () => ({
        Component: (await import('@/features/appeals/appeal-pages')).AppealQueuePage,
      }),
    },
    {
      path: 'dashboard/appeals/new',
      lazy: async () => ({
        Component: (await import('@/features/appeals/appeal-pages')).SubmitAppealPage,
      }),
    },
    {
      path: 'projects/:id',
      lazy: async () => ({
        Component: (await import('@/features/projects/project-page')).ProjectPage,
      }),
    },
    { path: 'admin', lazy: async () => ({ Component: (await comingSoon()).AdminPage }) },
  ];
}

/** Dev-only pages. `import.meta.env.DEV` is false in production builds, so these are dropped. */
function devRoutes(): RouteObject[] {
  if (!import.meta.env.DEV) return [];
  return [
    {
      path: 'dev/components',
      lazy: async () => ({ Component: (await import('@/dev/components-page')).ComponentsPage }),
    },
  ];
}

export function createRouter() {
  return createBrowserRouter(routes);
}
