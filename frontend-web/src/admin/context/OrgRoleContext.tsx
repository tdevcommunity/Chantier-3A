import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useEvent } from './EventContext';
import { usersService } from '../services/users.service';
import type { OrgRole } from '../types';

interface OrgRoleContextType {
  orgRole: OrgRole | null;
  loading: boolean;
  refreshOrgRole: () => Promise<void>;
}

const OrgRoleContext = createContext<OrgRoleContextType>({
  orgRole: null,
  loading: true,
  refreshOrgRole: async () => {},
});

export const OrgRoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useAuth();
  const { orgId } = useEvent();
  const [orgRole, setOrgRole] = useState<OrgRole | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshOrgRole = useCallback(async () => {
    if (!isAuthenticated || !user?.id || !orgId) {
      setOrgRole(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const members = await usersService.getOrgMembers(orgId);
      const me = members.find((m) => m.user_id === user.id);
      setOrgRole((me?.role as OrgRole) ?? null);
    } catch {
      setOrgRole(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.id, orgId]);

  useEffect(() => {
    void refreshOrgRole();
  }, [refreshOrgRole]);

  return (
    <OrgRoleContext.Provider value={{ orgRole, loading, refreshOrgRole }}>
      {children}
    </OrgRoleContext.Provider>
  );
};

export function useOrgRole() {
  return useContext(OrgRoleContext);
}