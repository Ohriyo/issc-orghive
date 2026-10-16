import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { createQueryClient } from '@/app/query-client';
import { createRouter } from '@/app/router';
import { refreshSession } from '@/lib/api';
import './index.css';

// index.html's default SEO tags are for crawlers that do not run JavaScript. Once the app
// runs, every page sets its own through <Seo>; removing the defaults avoids duplicates.
document.head.querySelectorAll('[data-default-seo]').forEach((tag) => tag.remove());

// Silent refresh: the access token lives in memory only, so every page load asks the
// API to exchange the httpOnly refresh cookie for a new one (or learns no one is signed in).
void refreshSession();

const queryClient = createQueryClient();
const router = createRouter();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
