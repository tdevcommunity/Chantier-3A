import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { EventProvider, useEvent } from './context/EventContext';
import { AdminLayout } from './components/layout/AdminLayout';

import { DashboardPage } from './pages/DashboardPage';
import { ParticipantsPage } from './pages/ParticipantsPage';
import { InsightsPage } from './pages/InsightsPage';
import { ParticipantDetailPage } from './pages/ParticipantDetailPage';
import { TicketsPage } from './pages/TicketsPage';
import { TicketTypesPage } from './pages/TicketTypesPage';
import { NexusNightPage } from './pages/NexusNightPage';
import { AdmissionsPage } from './pages/AdmissionsPage';
import { LoginPage } from './pages/LoginPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { UsersPage } from './pages/UsersPage';
import { EventSettingsPage } from './pages/EventSettingsPage';
import { AuthCallbackPage } from './pages/AuthCallbackPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';

import { getAdminRoute } from '@/lib/env';
import { STOREFRONT_THEME_CLASS } from '@/components/storefront/StorefrontTheme';
import { AdminLoadingScreen, AdminTdevLogo } from './components/brand/AdminTdevLogo';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, staffAccessDenied, verifyStaffAccess, logout } = useAuth();
  const { eventId, loading: eventLoading } = useEvent();
  const adminRoute = getAdminRoute();

  useEffect(() => {
    if (isAuthenticated && eventId && !eventLoading) {
      verifyStaffAccess(eventId);
    }
  }, [isAuthenticated, eventId, eventLoading, verifyStaffAccess]);

  if (isLoading || (isAuthenticated && eventLoading)) {
    return <AdminLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to={`${adminRoute}/login`} replace />;
  }

  if (staffAccessDenied) {
    return (
      <div className="admin-app flex min-h-screen flex-col items-center justify-center gap-4 bg-[#ecefed] p-6">
        <AdminTdevLogo variant="onLight" size="lg" />
        <h1 className="text-xl font-semibold text-zinc-900">Accès refusé</h1>
        <p className="max-w-md text-center text-sm text-zinc-600">
          Votre compte n’a pas les droits administrateur sur cet événement.
        </p>
        <button
          type="button"
          onClick={() => logout()}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
        >
          Se déconnecter
        </button>
      </div>
    );
  }

  return <>{children}</>;
};

export const AdminApp: React.FC = () => {
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex, nofollow');

    document.documentElement.classList.remove('dark', STOREFRONT_THEME_CLASS);
    document.documentElement.classList.add('light');
  }, []);

  return (
    <ToastProvider>
      <AuthProvider>
        <EventProvider>
          <Routes>
            <Route path="login" element={<LoginPage />} />
            <Route path="auth/callback" element={<AuthCallbackPage />} />
            <Route path="accept-invite" element={<AcceptInvitePage />} />

            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="event" element={<EventSettingsPage />} />
              <Route path="participants" element={<ParticipantsPage />} />
              <Route path="participants/:id" element={<ParticipantDetailPage />} />
              <Route path="insights" element={<InsightsPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="orders/:id" element={<OrderDetailPage />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="ticket-types" element={<TicketTypesPage />} />
              <Route path="nexus-night" element={<NexusNightPage />} />
              <Route path="admissions" element={<AdmissionsPage />} />
              <Route path="team" element={<UsersPage />} />
              <Route path="*" element={<Navigate to="dashboard" replace />} />
            </Route>
          </Routes>
        </EventProvider>
      </AuthProvider>
    </ToastProvider>
  );
};

export default AdminApp;
