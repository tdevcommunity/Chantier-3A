import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { authFetch, apiFetch } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AdminTdevLogo } from '../components/brand/AdminTdevLogo';
import { AdminAuthShell } from '../components/brand/AdminAuthShell';
import { adminUserMessage } from '../lib/admin-user-message';

export const AcceptInvitePage: React.FC = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const { login, isAuthenticated } = useAuth();
  const { success, error } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [loading, setLoading] = useState(false);

  const accept = async () => {
    if (!token) {
      error('Invitation', 'Jeton manquant.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        await authFetch('/signup-with-invite', {
          method: 'POST',
          body: JSON.stringify({ token, email, password, name }),
        });
        const ok = await login(email, password);
        if (!ok) return;
      } else {
        const ok = await login(email, password);
        if (!ok) return;
        await apiFetch('/invites/accept', {
          method: 'POST',
          body: JSON.stringify({ token }),
        });
      }
      success('Invitation acceptée', 'Vous avez rejoint l’organisation.');
      navigate('../dashboard', { replace: true });
    } catch (err: unknown) {
      error('Invitation', adminUserMessage(err, 'Action impossible.'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 bg-[#f7fcf8]">
        <AdminTdevLogo variant="onLight" size="lg" />
        <p className="text-slate-600">Lien d’invitation invalide.</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 bg-[#f7fcf8]">
        <AdminTdevLogo variant="onLight" size="lg" />
        <p className="text-slate-700">Vous êtes déjà connecté.</p>
        <button
          type="button"
          className="rounded-xl bg-green-800 px-4 py-2 text-white font-semibold"
          onClick={async () => {
            setLoading(true);
            try {
              await apiFetch('/invites/accept', {
                method: 'POST',
                body: JSON.stringify({ token }),
              });
              success('Invitation acceptée', '');
              navigate('../dashboard', { replace: true });
            } catch (err: unknown) {
              error('Invitation', adminUserMessage(err, 'Action impossible.'));
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading}
        >
          Accepter l’invitation
        </button>
      </div>
    );
  }

  return (
    <AdminAuthShell
      title="Rejoindre l’équipe TDEV"
      description="Créez un compte ou connectez-vous pour accepter l’invitation."
    >
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setMode('signup')}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === 'signup' ? 'bg-green-800 text-white' : 'bg-green-50 text-green-900'}`}
        >
          Créer un compte
        </button>
        <button
          type="button"
          onClick={() => setMode('login')}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === 'login' ? 'bg-green-800 text-white' : 'bg-green-50 text-green-900'}`}
        >
          Se connecter
        </button>
      </div>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
      >
        {mode === 'signup' && (
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom complet"
            className="w-full rounded-xl border border-green-200 px-3 py-2.5"
          />
        )}
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          className="w-full rounded-xl border border-green-200 px-3 py-2.5"
        />
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
          className="w-full rounded-xl border border-green-200 px-3 py-2.5"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-green-800 py-3 font-bold text-white disabled:opacity-60"
        >
          {loading ? 'Traitement…' : 'Continuer'}
        </button>
      </form>
    </AdminAuthShell>
  );
};
