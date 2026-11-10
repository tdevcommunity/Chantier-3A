import { apiFetch } from './api';
import { OrganizationMember } from '../types';

export const usersService = {
  async getOrgMembers(orgId?: string | null): Promise<OrganizationMember[]> {
    if (!orgId) return [];
    const res = await apiFetch<{
      members: { user_id: string; name: string; email: string; role: string }[];
    }>(`/orgs/${orgId}/members`);
    return (res.members || []).map((m) => ({
      org_id: orgId,
      user_id: m.user_id,
      role: m.role as OrganizationMember['role'],
      created_at: '',
      user: {
        id: m.user_id,
        email: m.email,
        name: m.name,
        created_at: '',
      },
    }));
  },

  async getInvites(orgId?: string | null): Promise<
    { id: string; email: string; role: string; expires_at: string; created_at: string }[]
  > {
    if (!orgId) return [];
    const res = await apiFetch<{ invites: Record<string, string>[] }>(`/orgs/${orgId}/invites`);
    return (res.invites || []).map((i) => ({
      id: String(i.id),
      email: String(i.email),
      role: String(i.role),
      expires_at: String(i.expires_at),
      created_at: String(i.created_at),
    }));
  },

  async inviteMember(
    orgId: string,
    email: string,
    role: 'admin' | 'scanner' | 'owner',
  ): Promise<{ token: string; expires_at: string; invite_id?: string; email_sent?: boolean }> {
    return apiFetch(`/orgs/${orgId}/invites`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  },

  async revokeInvite(inviteId: string): Promise<void> {
    await apiFetch(`/invites/${inviteId}`, { method: 'DELETE' });
  },

  async updateMemberRole(orgId: string, userId: string, role: string): Promise<void> {
    await apiFetch(`/orgs/${orgId}/members/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  },

  async removeMember(orgId: string, userId: string): Promise<void> {
    await apiFetch(`/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
  },

  async createOrUpdateStaff(
    orgId: string,
    payload: { email: string; name?: string; password?: string; role?: 'scanner' | 'admin' },
  ): Promise<{ ok: boolean; user: { id: string; email: string; name: string; role: string } }> {
    return apiFetch(`/orgs/${orgId}/staff`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async resetStaffPassword(
    orgId: string,
    userId: string,
    newPassword: string,
  ): Promise<{ ok: boolean; message: string }> {
    return apiFetch(`/orgs/${orgId}/staff/${userId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    });
  },

  async changeMyPassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean; message: string }> {
    return apiFetch(`/auth/change-password`, {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
  },
};
