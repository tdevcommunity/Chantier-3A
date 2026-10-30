import React, { useState, useEffect, useMemo } from 'react';
import { UserPlus, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { usersService } from '../services/users.service';
import { useEvent } from '../context/EventContext';
import { useToast } from '../context/ToastContext';
import { OrganizationMember, OrgRole } from '../types';
import { getAdminRoute } from '@/lib/env';
import { adminMessages, adminUserMessage } from '../lib/admin-user-message';
import { useAuth } from '../context/AuthContext';

const ROLE_RANK: Record<OrgRole, number> = {
  scanner: 1,
  admin: 2,
  owner: 3,
};

export const UsersPage: React.FC = () => {
  const { orgId } = useEvent();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invites, setInvites] = useState<
    { id: string; email: string; role: string; expires_at: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'scanner'>('scanner');

  const myRole = useMemo((): OrgRole | null => {
    if (!user?.id) return null;
    const me = members.find((m) => m.user_id === user.id);
    return me?.role ?? null;
  }, [members, user?.id]);

  const loadData = async () => {
    if (!orgId) return;
    try {
      setLoading(true);
      setError(null);
      const [m, i] = await Promise.all([
        usersService.getOrgMembers(orgId),
        usersService.getInvites(orgId),
      ]);
      setMembers(m);
      setInvites(i);
    } catch (err: unknown) {
      setError(adminUserMessage(err, adminMessages.loadTeamFailed));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [orgId]);

  const invite = async () => {
    if (!orgId || !inviteEmail.trim()) return;
    try {
      const res = await usersService.inviteMember(orgId, inviteEmail.trim(), inviteRole);
      const adminRoute = getAdminRoute() || '';
      const link = `${window.location.origin}${adminRoute}/accept-invite?token=${encodeURIComponent(res.token)}`;
      await navigator.clipboard.writeText(link);
      if (res.email_sent) {
        success('Invitation', adminMessages.inviteCreatedEmail(inviteEmail.trim()));
      } else {
        success('Invitation', adminMessages.inviteCreatedClipboard);
      }
      setInviteEmail('');
      loadData();
    } catch (err: unknown) {
      toastError('Invitation', adminUserMessage(err, adminMessages.inviteFailed));
    }
  };

  const revoke = async (inviteId: string) => {
    try {
      await usersService.revokeInvite(inviteId);
      success('Invitation révoquée', '');
      loadData();
    } catch (err: unknown) {
      toastError('Révocation', adminUserMessage(err, adminMessages.genericRetry));
    }
  };

  const changeRole = async (userId: string, role: string) => {
    if (!orgId) return;
    try {
      await usersService.updateMemberRole(orgId, userId, role);
      success('Rôle mis à jour', '');
      loadData();
    } catch (err: unknown) {
      toastError('Rôle', adminUserMessage(err, adminMessages.roleChangeDenied));
    }
  };

  const removeMember = async (member: OrganizationMember) => {
    if (!orgId) return;
    const label = member.user?.email || member.user?.name || 'ce membre';
    if (!window.confirm(`Retirer ${label} de l’équipe ? Cette personne n’aura plus accès à l’administration.`)) {
      return;
    }
    try {
      await usersService.removeMember(orgId, member.user_id);
      success('Équipe', adminMessages.memberRemoved);
      loadData();
    } catch (err: unknown) {
      toastError('Retrait', adminUserMessage(err, adminMessages.memberRemoveDenied));
    }
  };

  const canEditMember = (member: OrganizationMember): boolean => {
    if (!myRole) return false;
    if (member.user_id === user?.id) return false;
    if (member.role === 'owner' && myRole !== 'owner') return false;
    return ROLE_RANK[member.role] <= ROLE_RANK[myRole];
  };

  const roleOptionsFor = (member: OrganizationMember): OrgRole[] => {
    if (!myRole) return [];
    const opts: OrgRole[] = ['scanner', 'admin'];
    if (myRole === 'owner' && member.role === 'owner') {
      return ['owner'];
    }
    if (myRole === 'owner') {
      opts.push('owner');
    }
    return opts;
  };

  if (!orgId) {
    return <ErrorState message={adminMessages.loadTeamFailed} onRetry={loadData} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Équipe" subtitle="Membres, rôles et invitations staff" />

      <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm flex flex-wrap gap-3 items-end">
        <label className="flex-1 min-w-[200px] text-sm font-semibold">
          E-mail
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="nouveau@tdev.bj"
          />
        </label>
        <label className="text-sm font-semibold">
          Rôle
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'admin' | 'scanner')}
            className="mt-1 block rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="scanner">Scanner</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          type="button"
          onClick={invite}
          className="inline-flex items-center gap-2 rounded-xl bg-green-800 px-4 py-2.5 text-sm font-bold text-white"
        >
          <UserPlus className="h-4 w-4" />
          Inviter
        </button>
      </div>

      {loading ? (
        <TableSkeleton rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-500 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-6">Membre</th>
                  <th className="py-3 px-6">E-mail</th>
                  <th className="py-3 px-6">Rôle</th>
                  <th className="py-3 px-6 w-16" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td className="py-3 px-6 font-semibold">{m.user?.name}</td>
                    <td className="py-3 px-6">{m.user?.email}</td>
                    <td className="py-3 px-6">
                      {canEditMember(m) ? (
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.user_id, e.target.value)}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
                        >
                          {roleOptionsFor(m).map((r) => (
                            <option key={r} value={r}>
                              {r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : 'Scanner'}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-semibold capitalize text-slate-700">{m.role}</span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-right">
                      {canEditMember(m) ? (
                        <button
                          type="button"
                          onClick={() => removeMember(m)}
                          className="text-rose-600 hover:bg-rose-50 p-2 rounded-lg"
                          title="Retirer de l’équipe"
                          aria-label={`Retirer ${m.user?.email ?? m.user?.name ?? 'membre'}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {members.length === 0 && <EmptyState title="Aucun membre." />}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <p className="px-6 py-4 text-sm font-bold text-slate-800 border-b">Invitations en attente</p>
            {invites.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">Aucune invitation.</p>
            ) : (
              <ul className="divide-y">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
                    <div>
                      <p className="font-semibold">{inv.email}</p>
                      <p className="text-xs text-slate-500">
                        {inv.role} · expire {inv.expires_at}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => revoke(inv.id)}
                      className="text-rose-600 hover:bg-rose-50 p-2 rounded-lg"
                      title="Révoquer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
};
