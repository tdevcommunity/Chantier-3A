import React, { useState, useEffect, useMemo } from 'react';
import { UserPlus, Trash2, KeyRound, Copy, Check, Shield, RefreshCw } from 'lucide-react';
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

  // New Staff Modal / Form state
  const [staffEmail, setStaffEmail] = useState('');
  const [staffName, setStaffName] = useState('');
  const [staffPassword, setStaffPassword] = useState('Tfestiv2026');
  const [staffRole, setStaffRole] = useState<'admin' | 'scanner'>('scanner');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset Password Modal state
  const [resetModalMember, setResetModalMember] = useState<OrganizationMember | null>(null);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  // Success Credential Modal state
  const [createdCredentials, setCreatedCredentials] = useState<{
    email: string;
    password: string;
    role: string;
  } | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

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

  const handleGeneratePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setStaffPassword(pwd);
  };

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !staffEmail.trim()) return;

    try {
      setIsSubmitting(true);
      const res = await usersService.createOrUpdateStaff(orgId, {
        email: staffEmail.trim(),
        name: staffName.trim() || undefined,
        password: staffPassword.trim() || 'Tfestiv2026',
        role: staffRole,
      });

      setCreatedCredentials({
        email: res.user.email,
        password: staffPassword.trim() || 'Tfestiv2026',
        role: res.user.role,
      });

      success('Agent créé avec succès', `${res.user.email} a été ajouté à l'équipe.`);
      setStaffEmail('');
      setStaffName('');
      setStaffPassword('Tfestiv2026');
      loadData();
    } catch (err: unknown) {
      toastError('Erreur création staff', adminUserMessage(err, 'Impossible de créer ce compte staff.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !resetModalMember || !newResetPassword.trim()) return;

    try {
      setIsResetting(true);
      await usersService.resetStaffPassword(orgId, resetModalMember.user_id, newResetPassword.trim());
      success(
        'Mot de passe réinitialisé',
        `Le mot de passe de ${resetModalMember.user?.email} a été mis à jour.`,
      );
      setCreatedCredentials({
        email: resetModalMember.user?.email || '',
        password: newResetPassword.trim(),
        role: resetModalMember.role,
      });
      setResetModalMember(null);
      setNewResetPassword('');
    } catch (err: unknown) {
      toastError('Erreur réinitialisation', adminUserMessage(err, 'Impossible de réinitialiser le mot de passe.'));
    } finally {
      setIsResetting(false);
    }
  };

  const copyCredentials = async () => {
    if (!createdCredentials) return;
    const adminRoute = getAdminRoute() || '';
    const webLoginUrl = `${window.location.origin}${adminRoute}/login`;
    const text = `Accès TDEV Festival :\n- E-mail : ${createdCredentials.email}\n- Mot de passe : ${createdCredentials.password}\n- Rôle : ${createdCredentials.role}\n- Lien de connexion : ${webLoginUrl}\n(Vous pourrez changer votre mot de passe dès votre première connexion).`;
    await navigator.clipboard.writeText(text);
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2500);
    success('Accès copiés', 'Les identifiants ont été copiés dans votre presse-papiers.');
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
      <PageHeader
        title="Équipe & Agents Staff"
        subtitle="Créez directement vos agents, gérez leurs identifiants et contrôlez les accès scanner"
      />

      {/* Direct Staff Addition Card */}
      <div className="rounded-2xl border border-slate-100 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Ajouter un agent staff ou administrateur</h2>
            <p className="text-xs text-zinc-500">
              Crée le compte immédiatement avec son mot de passe pour un accès instantané (mobile et web).
            </p>
          </div>
        </div>

        <form onSubmit={handleAddStaff} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
          <label className="text-xs font-semibold text-zinc-700">
            E-mail du staff *
            <input
              type="email"
              value={staffEmail}
              onChange={(e) => setStaffEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              placeholder="agent@festiv.com"
              required
            />
          </label>

          <label className="text-xs font-semibold text-zinc-700">
            Nom / Prénom (optionnel)
            <input
              type="text"
              value={staffName}
              onChange={(e) => setStaffName(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              placeholder="Ex: Rodrigue K."
            />
          </label>

          <label className="text-xs font-semibold text-zinc-700">
            <div className="flex justify-between items-center">
              <span>Mot de passe</span>
              <button
                type="button"
                onClick={handleGeneratePassword}
                className="text-[10px] text-emerald-700 hover:underline flex items-center gap-0.5"
              >
                <RefreshCw className="w-2.5 h-2.5" /> Aléatoire
              </button>
            </div>
            <input
              type="text"
              value={staffPassword}
              onChange={(e) => setStaffPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              placeholder="Min. 8 caractères"
              required
            />
          </label>

          <div className="flex gap-2">
            <label className="text-xs font-semibold text-zinc-700 flex-1">
              Rôle
              <select
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value as 'admin' | 'scanner')}
                className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold focus:ring-2 focus:ring-emerald-600 focus:outline-none"
              >
                <option value="scanner">Scanner (Agent de porte)</option>
                <option value="admin">Admin (Gestionnaire)</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50 mt-auto h-[34px]"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {isSubmitting ? '...' : 'Créer'}
            </button>
          </div>
        </form>
      </div>

      {/* Credentials Banner / Modal when an account is created or reset */}
      {createdCredentials && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50/70 p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
              <Shield className="w-4 h-4 text-emerald-600" />
              Identifiants de l'agent prêts à être partagés
            </span>
            <button
              type="button"
              onClick={() => setCreatedCredentials(null)}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              Fermer
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs bg-white p-3.5 rounded-xl border border-emerald-200 font-mono">
            <div>
              <span className="text-zinc-500 block text-[10px] uppercase font-sans">E-mail</span>
              <span className="font-semibold text-zinc-900 select-all">{createdCredentials.email}</span>
            </div>
            <div>
              <span className="text-zinc-500 block text-[10px] uppercase font-sans">Mot de passe</span>
              <span className="font-bold text-emerald-700 select-all">{createdCredentials.password}</span>
            </div>
            <div>
              <span className="text-zinc-500 block text-[10px] uppercase font-sans">Rôle</span>
              <span className="font-semibold text-zinc-800 capitalize font-sans">{createdCredentials.role}</span>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={copyCredentials}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold px-4 py-2 transition"
            >
              {hasCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {hasCopied ? 'Copié dans le presse-papiers !' : 'Copier les accès (WhatsApp / SMS)'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={loadData} />
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-900">Membres actifs ({members.length})</h3>
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b bg-slate-50 text-slate-500 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-6">Nom</th>
                  <th className="py-3 px-6">E-mail</th>
                  <th className="py-3 px-6">Rôle</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => (
                  <tr key={m.user_id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-6 font-semibold text-zinc-900">{m.user?.name || '—'}</td>
                    <td className="py-3 px-6 text-zinc-600 font-mono text-[11px]">{m.user?.email}</td>
                    <td className="py-3 px-6">
                      {canEditMember(m) ? (
                        <select
                          value={m.role}
                          onChange={(e) => changeRole(m.user_id, e.target.value)}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold focus:ring-1 focus:ring-emerald-600"
                        >
                          {roleOptionsFor(m).map((r) => (
                            <option key={r} value={r}>
                              {r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : 'Scanner'}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-semibold capitalize text-slate-700 px-2 py-0.5 rounded-md bg-slate-100 text-[11px]">
                          {m.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-right space-x-1">
                      {canEditMember(m) && (
                        <button
                          type="button"
                          onClick={() => {
                            setResetModalMember(m);
                            setNewResetPassword('');
                          }}
                          className="inline-flex items-center gap-1 text-zinc-600 hover:text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg text-xs font-medium transition"
                          title="Réinitialiser le mot de passe"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          <span>Réinitialiser</span>
                        </button>
                      )}
                      {canEditMember(m) ? (
                        <button
                          type="button"
                          onClick={() => removeMember(m)}
                          className="text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg transition"
                          title="Retirer de l’équipe"
                          aria-label={`Retirer ${m.user?.email ?? m.user?.name ?? 'membre'}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {members.length === 0 && <EmptyState title="Aucun membre." />}
          </div>

          {invites.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <p className="px-6 py-4 text-sm font-bold text-slate-800 border-b">Invitations en attente</p>
              <ul className="divide-y divide-slate-100">
                {invites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
                    <div>
                      <p className="font-semibold text-xs">{inv.email}</p>
                      <p className="text-[11px] text-slate-500">
                        {inv.role} · expire {inv.expires_at}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => revoke(inv.id)}
                      className="text-rose-600 hover:bg-rose-50 p-1.5 rounded-lg text-xs font-semibold"
                      title="Révoquer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {/* Reset Password Modal */}
      {resetModalMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 p-6 max-w-sm w-full space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-zinc-900">
                Nouveau mot de passe pour {resetModalMember.user?.email}
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                L'agent pourra se connecter immédiatement avec ce nouveau code.
              </p>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Nouveau mot de passe
                </label>
                <input
                  type="text"
                  value={newResetPassword}
                  onChange={(e) => setNewResetPassword(e.target.value)}
                  placeholder="Ex: Tfestiv2026"
                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-emerald-600 focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResetModalMember(null)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-zinc-600 hover:bg-zinc-100"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isResetting || !newResetPassword.trim()}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50"
                >
                  {isResetting ? 'Mise à jour...' : 'Confirmer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
