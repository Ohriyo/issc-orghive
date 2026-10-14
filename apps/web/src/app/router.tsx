import { createBrowserRouter, type RouteObject } from 'react-router';
import { RootLayout } from './root-layout';
import { RouteErrorPage } from './route-error-page';
import { PlaceholderPage } from './placeholder-page';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [{ index: true, element: <PlaceholderPage /> }],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
