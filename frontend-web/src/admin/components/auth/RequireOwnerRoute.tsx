import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useOrgRole } from '../../context/OrgRoleContext';
import { useToast } from '../../context/ToastContext';
import { canAccessAdminRoute } from '../../lib/org-permissions';
import { getAdminRoute } from '@/lib/env';

export const RequireOwnerRoute: React.FC<{ segment: string; children: React.ReactNode }> = ({
  segment,
  children,
}) => {
  const { orgRole, loading } = useOrgRole();
  const location = useLocation();
  const { error } = useToast();
  const adminRoute = getAdminRoute() || '';

  if (loading) {
    return null;
  }

  if (!canAccessAdminRoute(orgRole, segment)) {
    if (orgRole === 'admin') {
      error('Accès refusé', 'Cette section est réservée au super administrateur.');
    }
    return <Navigate to={`${adminRoute}/dashboard`} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};