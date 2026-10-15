import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@cullinari/shared';
import { ApiError } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/ui';
import { Billing } from './pages/Billing';
import { Branches } from './pages/Branches';
import { Home } from './pages/Home';
import { Inventory } from './pages/Inventory';
import { ChangePassword, Login } from './pages/Login';
import { Menu } from './pages/Menu';
import { Orders } from './pages/Orders';
import { Settings } from './pages/Settings';
import { Team } from './pages/Team';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { can } = useAuth();
  return can(...roles) ? <>{children}</> : <Navigate to="/orders" replace />;
}

function App() {
  const { token, me, loading } = useAuth();
  if (!token) return <Login />;
  if (loading || !me) return <p className="muted" style={{ padding: 28 }}>Loading…</p>;
  if (me.user.mustResetPassword) return <ChangePassword forced />;

  const home = me.role === 'owner' || me.role === 'manager' ? <Home /> : <Navigate to="/orders" replace />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={home} />
        <Route path="orders" element={<Orders />} />
        <Route path="menu" element={<Guard roles={['owner', 'manager', 'cashier']}><Menu /></Guard>} />
        <Route path="inventory" element={<Guard roles={['owner', 'manager']}><Inventory /></Guard>} />
        <Route path="branches" element={<Guard roles={['owner']}><Branches /></Guard>} />
        <Route path="team" element={<Guard roles={['owner']}><Team /></Guard>} />
        <Route path="billing" element={<Guard roles={['owner']}><Billing /></Guard>} />
        <Route path="settings" element={<Guard roles={['owner']}><Settings /></Guard>} />
        <Route path="account/password" element={<ChangePassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
