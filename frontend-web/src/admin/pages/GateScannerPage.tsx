import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle, AlertTriangle, UserSearch, Hash } from 'lucide-react';
import { AdminTdevLogo } from '../components/brand/AdminTdevLogo';
import { gateScanService, type ScanPreview, type ScanResult } from '../services/gate-scan.service';
import { useAuth } from '../context/AuthContext';
import { getAdminRoute } from '@/lib/env';
import { cn } from '../lib/utils';

type Mode = 'serial' | 'name';
type Step = 'input' | 'confirm' | 'result';

const PASS_PREFIX = 'TDEV-2026-';

function resultTone(result: string): 'ok' | 'warn' | 'bad' {
  if (result === 'admitted') return 'ok';
  if (result === 'duplicate') return 'warn';
  return 'bad';
}

export const GateScannerPage: React.FC = () => {
  const { isAuthenticated, isLoading, logout } = useAuth();
  const adminRoute = getAdminRoute();
  const [mode, setMode] = useState<Mode>('serial');
  const [step, setStep] = useState<Step>('input');
  const [eventId, setEventId] = useState('');
  const [events, setEvents] = useState<{ id: string; title: string }[]>([]);
  const [serialSuffix, setSerialSuffix] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [nameMatches, setNameMatches] = useState<ScanPreview[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    void (async () => {
      try {
        const res = await gateScanService.listEvents();
        const list = res.events || [];
        setEvents(list.map((e) => ({ id: e.id, title: e.title })));
        if (list.length === 1) setEventId(list[0]!.id);
      } catch {
        setError('Impossible de charger les événements.');
      }
    })();
  }, [isAuthenticated]);

  const resetFlow = () => {
    setStep('input');
    setPreview(null);
    setNameMatches([]);
    setScanResult(null);
    setError(null);
    setSerialSuffix('');
    setNameQuery('');
  };

  const runLookupSerial = useCallback(async (overrideSuffix?: string) => {
    const suffix = (overrideSuffix ?? serialSuffix).replace(/\D/g, '').slice(-4);
    if (!eventId || suffix.length < 1) {
      setError('Saisissez les 4 chiffres du pass.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await gateScanService.lookupSerial(eventId, suffix);
      if (!res.found || !res.preview) {
        setError(
          res.reason === 'ticket_not_valid'
            ? 'Ce pass n’est plus valide.'
            : 'Pass introuvable.',
        );
        return;
      }
      setPreview(res.preview);
      setStep('confirm');
    } catch {
      setError('Vérification impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  }, [eventId, serialSuffix]);

  const runLookupName = useCallback(async (overrideQuery?: string) => {
    const query = (overrideQuery ?? nameQuery).trim();
    if (!eventId || query.length < 3) {
      setError('Saisissez au moins 3 caractères.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await gateScanService.lookupName(eventId, query);
      if (!res.matches?.length) {
        setError('Aucun billet trouvé pour ce nom.');
        return;
      }
      if (res.matches.length === 1) {
        setPreview(res.matches[0]!);
        setStep('confirm');
        return;
      }
      setNameMatches(res.matches);
      setStep('confirm');
    } catch {
      setError('Recherche impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  }, [eventId, nameQuery]);

  useEffect(() => {
    if (!eventId || deepLinkHandled.current) return;
    const modeP = searchParams.get('mode');
    const suffixRaw = searchParams.get('suffix');
    const q = searchParams.get('q')?.trim() ?? '';
    if (modeP === 'serial' || modeP === 'name') setMode(modeP);
    if (suffixRaw) setSerialSuffix(suffixRaw.replace(/\D/g, '').slice(0, 4));
    if (q) setNameQuery(q);

    if (modeP === 'serial' && suffixRaw?.replace(/\D/g, '')) {
      deepLinkHandled.current = true;
      void runLookupSerial(suffixRaw);
    } else if (modeP === 'name' && q.length >= 3) {
      deepLinkHandled.current = true;
      void runLookupName(q);
    }
  }, [eventId, searchParams, runLookupSerial, runLookupName]);

  const confirmAdmit = async (serial: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await gateScanService.admitBySerial(eventId, { serial });
      setScanResult(res);
      setStep('result');
    } catch {
      setError('Admission impossible. Réessayez.');
    } finally {
      setBusy(false);
    }
  };

  const tone = scanResult ? resultTone(scanResult.result) : null;

  if (!adminRoute) return null;
  if (isLoading) return null;
  if (!isAuthenticated) {
    return <Navigate to={`${adminRoute}/login`} replace />;
  }

  return (
    <div className="admin-app min-h-screen bg-[#0f1412] text-white flex flex-col">
      <header className="border-b border-white/10 px-4 py-4 flex items-center justify-between gap-3">
        <AdminTdevLogo variant="onDark" size="sm" />
        <p className="text-sm font-semibold text-emerald-300/90">Scanner web</p>
        <button
          type="button"
          onClick={() => logout()}
          className="text-xs text-white/60 hover:text-white"
        >
          Déconnexion
        </button>
      </header>

      <main className="flex-1 w-full max-w-md mx-auto p-4 space-y-5">
        {events.length > 1 ? (
          <label className="block text-sm">
            <span className="text-white/70">Événement</span>
            <select
              value={eventId}
              onChange={(e) => {
                setEventId(e.target.value);
                resetFlow();
              }}
              className="mt-1 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-white"
            >
              <option value="">Choisir…</option>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex rounded-xl bg-white/5 p-1 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setMode('serial');
              resetFlow();
            }}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold',
              mode === 'serial' ? 'bg-emerald-700 text-white' : 'text-white/60',
            )}
          >
            <Hash className="w-4 h-4" />
            N° pass
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('name');
              resetFlow();
            }}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold',
              mode === 'name' ? 'bg-emerald-700 text-white' : 'text-white/60',
            )}
          >
            <UserSearch className="w-4 h-4" />
            Nom
          </button>
        </div>

        {step === 'input' && mode === 'serial' ? (
          <Card
            title="Numéro de pass"
            hint={`Saisissez les 4 chiffres affichés sur le pass : ${PASS_PREFIX}XXXX`}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg font-mono text-emerald-400 shrink-0">{PASS_PREFIX}</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={serialSuffix}
                onChange={(e) => setSerialSuffix(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="flex-1 rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-2xl font-mono tracking-widest text-center"
                placeholder="0000"
              />
            </div>
            <PrimaryButton disabled={busy || !eventId} onClick={() => void runLookupSerial()}>
              {busy ? 'Vérification…' : 'Vérifier le billet'}
            </PrimaryButton>
          </Card>
        ) : null}

        {step === 'input' && mode === 'name' ? (
          <Card title="Recherche par nom" hint="Prénom, nom ou les deux.">
            <input
              type="search"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              className="w-full rounded-xl border border-white/20 bg-black/30 px-4 py-3 text-base"
              placeholder="Ex. Kouassi Ama"
            />
            <PrimaryButton disabled={busy || !eventId} onClick={() => void runLookupName()}>
              {busy ? 'Recherche…' : 'Rechercher'}
            </PrimaryButton>
          </Card>
        ) : null}

        {step === 'confirm' && preview && !nameMatches.length ? (
          <PreviewCard
            preview={preview}
            onConfirm={() => void confirmAdmit(preview.serial)}
            onCancel={resetFlow}
            busy={busy}
          />
        ) : null}

        {step === 'confirm' && nameMatches.length > 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-white/70">Plusieurs billets — choisissez le bon :</p>
            {nameMatches.map((m) => (
              <button
                key={m.ticket_id}
                type="button"
                onClick={() => {
                  setPreview(m);
                  setNameMatches([]);
                }}
                className="w-full text-left rounded-xl border border-white/15 bg-white/5 p-4 hover:bg-white/10"
              >
                <p className="font-semibold">{m.holder_name}</p>
                <p className="text-xs text-white/60 mt-1">{m.serial} · {m.pass_label}</p>
                <p className="text-xs text-emerald-300/80">{m.email_masked}</p>
              </button>
            ))}
            <button type="button" onClick={resetFlow} className="text-sm text-white/50 underline">
              Annuler
            </button>
          </div>
        ) : null}

        {step === 'result' && scanResult ? (
          <div
            className={cn(
              'rounded-2xl border p-6 text-center space-y-3',
              tone === 'ok' && 'border-emerald-500/50 bg-emerald-950/40',
              tone === 'warn' && 'border-amber-500/50 bg-amber-950/40',
              tone === 'bad' && 'border-rose-500/50 bg-rose-950/40',
            )}
          >
            {tone === 'ok' ? <CheckCircle2 className="w-14 h-14 mx-auto text-emerald-400" /> : null}
            {tone === 'warn' ? <AlertTriangle className="w-14 h-14 mx-auto text-amber-400" /> : null}
            {tone === 'bad' ? <XCircle className="w-14 h-14 mx-auto text-rose-400" /> : null}
            <p className="text-xl font-bold">
              {scanResult.result === 'admitted'
                ? 'Accès autorisé'
                : scanResult.result === 'duplicate'
                  ? 'Déjà admis'
                  : 'Refusé'}
            </p>
            {scanResult.holder_name ? (
              <p className="text-lg text-white/90">{scanResult.holder_name}</p>
            ) : null}
            {scanResult.serial ? (
              <p className="text-sm font-mono text-white/60">{scanResult.serial}</p>
            ) : null}
            <PrimaryButton onClick={resetFlow}>Participant suivant</PrimaryButton>
            <Link
              to={`${adminRoute}/admissions`}
              className="block text-center text-sm text-white/65 underline underline-offset-2 hover:text-white"
            >
              Voir le journal des scans
            </Link>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-rose-300 bg-rose-950/50 border border-rose-800/50 rounded-xl px-3 py-2">
            {error}
          </p>
        ) : null}

        <p className="text-center text-xs text-white/40 space-y-1">
          <Link to={`${adminRoute}/admissions`} className="block underline hover:text-white/70">
            Journal des scans (historique)
          </Link>
          <Link to={`${adminRoute}/login`} className="block underline hover:text-white/70">
            Déconnexion / espace staff
          </Link>
        </p>
      </main>
    </div>
  );
};

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
      <div>
        <h2 className="text-base font-bold">{title}</h2>
        {hint ? <p className="text-xs text-white/55 mt-1">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-3 text-sm font-bold"
    >
      {children}
    </button>
  );
}

function PreviewCard({
  preview,
  onConfirm,
  onCancel,
  busy,
}: {
  preview: ScanPreview;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-5 space-y-4">
      <p className="text-xs uppercase tracking-wide text-emerald-400/90 font-semibold">
        Vérifiez avec la personne
      </p>
      <div className="space-y-2">
        <p className="text-2xl font-bold">{preview.holder_name || '—'}</p>
        <p className="text-sm text-white/70">{preview.pass_label}</p>
        <p className="font-mono text-emerald-300">{preview.serial}</p>
        {preview.email_masked ? (
          <p className="text-sm text-white/60">E-mail : {preview.email_masked}</p>
        ) : null}
        {preview.admitted ? (
          <p className="text-sm text-amber-300">Attention : déjà marqué comme admis.</p>
        ) : null}
      </div>
      <PrimaryButton disabled={busy} onClick={onConfirm}>
        {busy ? 'Enregistrement…' : 'Confirmer et admettre'}
      </PrimaryButton>
      <button type="button" onClick={onCancel} className="w-full text-sm text-white/50 py-2">
        Annuler
      </button>
    </section>
  );
}