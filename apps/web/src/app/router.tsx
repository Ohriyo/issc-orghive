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
      path: 'search',
      lazy: async () => ({
        Component: (await import('@/features/search/search-page')).SearchPage,
      }),
    },
    {
      path: 'leaderboard',
      lazy: async () => ({
        Component: (await import('@/features/leaderboard/leaderboard-page')).LeaderboardPage,
      }),
    },
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
      path: 'updates',
      lazy: async () => ({
        Component: (await import('@/features/updates/updates-pages')).UpdatesPage,
      }),
    },
    {
      path: 'updates/:id',
      lazy: async () => ({
        Component: (await import('@/features/updates/updates-pages')).UpdatePage,
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
    { path: 'mfa-setup', lazy: async () => ({ Component: (await authPages()).MfaSetupPage }) },
    // The old signed-in landing page; its actions now live in the header's user menu.
    { path: 'account', element: <Navigate to="/dashboard" replace /> },
  ];
}

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
      path: 'dashboard/notifications',
      lazy: async () => ({
        Component: (await import('@/features/notifications/notifications-pages')).NotificationsPage,
      }),
    },
    {
      path: 'dashboard/notifications/settings',
      lazy: async () => ({
        Component: (await import('@/features/notifications/notifications-pages'))
          .NotificationSettingsPage,
      }),
    },
    {
      path: 'dashboard/compliance',
      lazy: async () => ({
        Component: (await import('@/features/compliance/compliance-page')).ComplianceOverviewPage,
      }),
    },
    {
      path: 'projects/:id',
      lazy: async () => ({
        Component: (await import('@/features/projects/project-page')).ProjectPage,
      }),
    },
    {
      path: 'admin',
      lazy: async () => ({
        Component: (await import('@/features/admin/admin-pages')).AdminIndexPage,
      }),
    },
    {
      path: 'admin/organizations',
      lazy: async () => ({
        Component: (await import('@/features/admin/admin-pages')).AdminOrganizationsPage,
      }),
    },
    {
      path: 'admin/financial-figures',
      lazy: async () => ({
        Component: (await import('@/features/admin/admin-pages')).AdminFinancialFiguresPage,
      }),
    },
    ...systemRoutes(),
  ];
}

const systemPages = () => import('@/features/system/system-pages');

/** /system: the super admin console. */
function systemRoutes(): RouteObject[] {
  return [
    { path: 'system', element: <Navigate to="/system/overview" replace /> },
    {
      path: 'system/overview',
      lazy: async () => ({ Component: (await systemPages()).SystemOverviewPage }),
    },
    {
      path: 'system/users',
      lazy: async () => ({ Component: (await systemPages()).SystemUsersPage }),
    },
    {
      path: 'system/users/new',
      lazy: async () => ({ Component: (await systemPages()).SystemNewAccountPage }),
    },
    {
      path: 'system/users/:userId',
      lazy: async () => ({ Component: (await systemPages()).SystemAccountPage }),
    },
    {
      path: 'system/accounts/bulk',
      lazy: async () => ({ Component: (await systemPages()).SystemBulkAccountsPage }),
    },
    {
      path: 'system/end-of-term',
      lazy: async () => ({ Component: (await systemPages()).SystemEndOfTermPage }),
    },
    {
      path: 'system/settings',
      lazy: async () => ({ Component: (await systemPages()).SystemSettingsPage }),
    },
    {
      path: 'system/account-requests',
      lazy: async () => ({ Component: (await systemPages()).SystemAccountRequestsPage }),
    },
    {
      path: 'system/test-data',
      lazy: async () => ({ Component: (await systemPages()).SystemTestDataPage }),
    },
    {
      path: 'system/super-admins',
      lazy: async () => ({ Component: (await systemPages()).SystemSuperAdminsPage }),
    },
    {
      path: 'system/audit',
      lazy: async () => ({ Component: (await systemPages()).SystemAuditPage }),
    },
    {
      path: 'system/security',
      lazy: async () => ({ Component: (await systemPages()).SystemSecurityPage }),
    },
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
