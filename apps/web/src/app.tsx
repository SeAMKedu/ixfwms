import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { ApiError } from './api/client';
import { SessionProvider } from './auth/session';
import { Layout } from './components/layout';
import { CarryPage } from './pages/carry';
import { CategoriesPage } from './pages/categories';
import { ImportPage } from './pages/import';
import { InboxPage } from './pages/inbox';
import { LabelsPage } from './pages/labels';
import { LocationPage } from './pages/location';
import { LoginPage } from './pages/login';
import { NotFoundPage } from './pages/not-found';
import { PartPage } from './pages/part';
import { PartEditPage } from './pages/part-edit';
import { PlacesPage } from './pages/places';
import { ScanPage } from './pages/scan';
import { SearchPage } from './pages/search';
import { SessionPage } from './pages/session';

/** Paths match the QR label format: /L/<code> for places, /P/<code> for parts (case-insensitive). */
const routes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <SearchPage /> },
      { path: '/parts/new', element: <PartEditPage /> },
      { path: '/p/:code', element: <PartPage /> },
      { path: '/p/:code/edit', element: <PartEditPage /> },
      { path: '/places', element: <PlacesPage /> },
      { path: '/l/:code', element: <LocationPage /> },
      { path: '/l/:code/add', element: <SessionPage /> },
      { path: '/carry', element: <CarryPage /> },
      { path: '/labels', element: <LabelsPage /> },
      { path: '/categories', element: <CategoriesPage /> },
      { path: '/import', element: <ImportPage /> },
      { path: '/inbox', element: <InboxPage /> },
      { path: '/scan', element: <ScanPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

const queryClient = createQueryClient();
const router = createBrowserRouter(routes);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>
  );
}
