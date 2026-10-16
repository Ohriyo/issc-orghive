import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout } from './root-layout';
import { RouteErrorPage } from './route-error-page';
import { HomePage } from '@/features/home/home-page';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'colleges',
        lazy: async () => ({
          Component: (await import('@/features/colleges/college-carousel-page'))
            .CollegeCarouselPage,
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
      ...authRoutes(),
      ...devRoutes(),
    ],
  },
];

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
    {
      path: 'account',
      lazy: async () => ({
        Component: (await import('@/features/account/account-page')).AccountPage,
      }),
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
