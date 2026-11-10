import React, { useState } from 'react';
import { Shield, Smartphone, KeyRound, QrCode, LogOut, Check, Copy, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { usersService } from '../services/users.service';
import { AdminTdevLogo } from '../components/brand/AdminTdevLogo';
import { getAdminRoute } from '@/lib/env';

export const StaffPortal: React.FC = () => {
  const { user, logout } = useAuth();
  const { success, error: toastError } = useToast();
  const adminRoute = getAdminRoute();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const scannerWebUrl = `${window.location.origin}${adminRoute}/scanner`;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      toastError('Erreur', 'Veuillez remplir tous les champs.');
      return;
    }
    if (newPassword.length < 8) {
      toastError('Erreur', 'Le mot de passe doit comporter au moins 8 caractères.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toastError('Erreur', 'Les deux mots de passe ne correspondent pas.');
      return;
    }

    try {
      setIsSubmitting(true);
      await usersService.changeMyPassword(currentPassword, newPassword);
      success('Succès', 'Votre mot de passe a été mis à jour avec succès.');
      setPasswordChanged(true);
      setCurrentPassword('');
      setNewPassword('');
      confirmPassword && setConfirmPassword('');
    } catch (err: any) {
      toastError('Erreur', err?.message || 'Impossible de mettre à jour le mot de passe.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyScannerLink = async () => {
    try {
      await navigator.clipboard.writeText(scannerWebUrl);
      setCopiedLink(true);
      success('Lien copié', 'Le lien vers le scanner a été copié dans le presse-papiers.');
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="admin-app min-h-screen bg-[#f4f6f5] flex flex-col items-center justify-center p-4 sm:p-6 text-zinc-900">
      <div className="w-full max-w-xl space-y-6">
        {/* Top Header Card */}
        <div className="bg-white rounded-3xl border border-zinc-200/80 p-6 sm:p-8 shadow-sm text-center relative">
          <div className="flex justify-center mb-4">
            <AdminTdevLogo variant="onLight" size="md" />
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-3">
            <Shield className="w-3.5 h-3.5" />
            Espace Agent Scanner Accrédité
          </span>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-zinc-900">
            Bienvenue, {user?.name || user?.email}
          </h1>
          <p className="text-xs sm:text-sm text-zinc-500 mt-1">
            Connecté avec <span className="font-medium text-zinc-700">{user?.email}</span>
          </p>

          <button
            onClick={() => logout()}
            className="absolute top-5 right-5 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 hover:text-rose-600 transition p-2 rounded-xl hover:bg-rose-50"
            title="Se déconnecter"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>

        {/* Action Grid: Scanner Web + Application Mobile */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Web Scanner */}
          <div className="bg-white rounded-2xl border border-zinc-200/80 p-5 shadow-sm flex flex-col justify-between">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
                <QrCode className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-zinc-900">Scanner Web</h2>
              <p className="text-xs text-zinc-500">
                Scannez directement avec l'appareil photo de votre smartphone ou navigateur.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-zinc-100 flex items-center gap-2">
              <a
                href={scannerWebUrl}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-2.5 px-3 transition shadow-sm"
              >
                Ouvrir le scanner
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={handleCopyScannerLink}
                className="p-2.5 rounded-xl border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition"
                title="Copier le lien direct"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Android Scanner App */}
          <div className="bg-white rounded-2xl border border-zinc-200/80 p-5 shadow-sm flex flex-col justify-between">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold">
                <Smartphone className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-zinc-900">Application Mobile</h2>
              <p className="text-xs text-zinc-500">
                Utilisez l'application Android dédiée <span className="font-semibold text-zinc-700">TDEV Scan</span> pour le contrôle d'accès hors-ligne.
              </p>
            </div>
            <div className="mt-4 pt-4 border-t border-zinc-100">
              <div className="rounded-xl bg-zinc-50 p-2.5 text-[11px] text-zinc-600 space-y-1">
                <p>1. Lancez l'application sur votre smartphone.</p>
                <p>2. Connectez-vous avec votre e-mail et mot de passe.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="bg-white rounded-2xl border border-zinc-200/80 p-6 shadow-sm">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-zinc-100 text-zinc-700 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Changer mon mot de passe</h2>
              <p className="text-xs text-zinc-500">
                Définissez votre propre mot de passe pour sécuriser vos connexions futures.
              </p>
            </div>
          </div>

          {passwordChanged && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" />
              <span>Votre mot de passe a bien été mis à jour. Utilisez-le désormais sur le scanner mobile et web.</span>
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 mb-1">
                Mot de passe actuel (ou mot de passe temporaire)
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Ex: Tfestiv2026"
                className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Nouveau mot de passe
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="8 caractères minimum"
                  className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 mb-1">
                  Confirmer le mot de passe
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Répétez le mot de passe"
                  className="w-full rounded-xl border border-zinc-200 px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  required
                />
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-bold py-2.5 px-4 transition disabled:opacity-50"
              >
                {isSubmitting ? 'Mise à jour...' : 'Enregistrer le nouveau mot de passe'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
