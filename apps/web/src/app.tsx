import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { ApiError } from './api/client';
import { LOGIN_ONLY } from './auth/require-login';
import { SessionProvider } from './auth/session';
import { ShortcutProvider } from './lib/shortcuts';
import { Layout } from './components/layout';
import { AccountPage } from './pages/account';
import { BackupsPage } from './pages/backups';
import { BomPage } from './pages/bom';
import { CarryPage } from './pages/carry';
import { CategoriesPage } from './pages/categories';
import { HistoryPage } from './pages/history';
import { WriteOffsPage } from './pages/write-offs';
import { ImportPage } from './pages/import';
import { InboxPage } from './pages/inbox';
import { LabelsPage } from './pages/labels';
import { MapsPage } from './pages/maps';
import { SettingsIndex, SettingsLayout } from './pages/settings';
import { CarryingSection } from './pages/settings/carrying';
import { GuestsSection } from './pages/settings/guests';
import { LabelsSection } from './pages/settings/labels';
import { LevelsSection } from './pages/settings/levels';
import { MappingsSection } from './pages/settings/mappings';
import { ServerSection } from './pages/settings/server';
import { TypesSection } from './pages/settings/types';
import { LocationPage } from './pages/location';
import { LoginPage } from './pages/login';
import { NotFoundPage } from './pages/not-found';
import { PartPage } from './pages/part';
import { PartEditPage } from './pages/part-edit';
import { PlacesPage } from './pages/places';
import { ScanPage } from './pages/scan';
import { HomePage } from './pages/home';
import { SearchPage } from './pages/search';
import { SessionPage } from './pages/session';
import { BuildsPage } from './pages/builds';
import { SetupPage } from './pages/setup';
import { UnitPage } from './pages/unit';
import { UserPage, UsersPage } from './pages/users';
import { NetworkPage } from './pages/network';

/** Paths match the QR label format: /L/<code> for places, /P/<code> for items, /U/<code> for units (case-insensitive). */
/** Pages that moved into Settings keep their old address working (with its query). */
function Redirect({ to }: { to: string }) {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
}

const routes = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/items', element: <SearchPage /> },
      { path: '/parts/new', element: <PartEditPage />, handle: LOGIN_ONLY },
      { path: '/p/:code', element: <PartPage /> },
      { path: '/p/:code/edit', element: <PartEditPage />, handle: LOGIN_ONLY },
      { path: '/u/:code', element: <UnitPage /> },
      { path: '/places', element: <PlacesPage /> },
      { path: '/builds', element: <BuildsPage /> },
      { path: '/l/:code', element: <LocationPage /> },
      { path: '/l/:code/add', element: <SessionPage />, handle: LOGIN_ONLY },
      { path: '/carry', element: <CarryPage />, handle: LOGIN_ONLY },
      { path: '/labels', element: <LabelsPage />, handle: LOGIN_ONLY },
      { path: '/maps', element: <MapsPage />, handle: LOGIN_ONLY },
      {
        path: '/settings',
        element: <SettingsLayout />,
        handle: LOGIN_ONLY,
        children: [
          { index: true, element: <SettingsIndex /> },
          { path: 'types', element: <TypesSection /> },
          { path: 'categories', element: <CategoriesPage /> },
          { path: 'levels', element: <LevelsSection /> },
          { path: 'carrying', element: <CarryingSection /> },
          { path: 'labels', element: <LabelsSection /> },
          { path: 'import', element: <MappingsSection /> },
          { path: 'users', element: <UsersPage /> },
          { path: 'users/:name', element: <UserPage /> },
          { path: 'guests', element: <GuestsSection /> },
          { path: 'backups', element: <BackupsPage /> },
          { path: 'server', element: <ServerSection /> },
        ],
      },
      { path: '/categories', element: <Redirect to="/settings/categories" /> },
      { path: '/import', element: <ImportPage />, handle: LOGIN_ONLY },
      { path: '/bom', element: <BomPage /> },
      { path: '/history', element: <HistoryPage />, handle: LOGIN_ONLY },
      { path: '/write-offs', element: <WriteOffsPage />, handle: LOGIN_ONLY },
      { path: '/network', element: <NetworkPage />, handle: LOGIN_ONLY },
      { path: '/users', element: <Redirect to="/settings/users" /> },
      { path: '/backups', element: <Redirect to="/settings/backups" /> },
      { path: '/setup', element: <SetupPage /> },
      { path: '/account', element: <AccountPage />, handle: LOGIN_ONLY },
      { path: '/inbox', element: <InboxPage />, handle: LOGIN_ONLY },
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
        <ShortcutProvider>
          <RouterProvider router={router} />
        </ShortcutProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
