import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Ticket,
  Calendar,
  Send,
  ShieldCheck,
  UserX,
} from 'lucide-react';
import { StatusBadge } from '../components/ui/StatusBadge';
import { participantsService } from '../services/participants.service';
import { ordersService } from '../services/orders.service';
import { ticketsService } from '../services/tickets.service';
import { useToast } from '../context/ToastContext';
import { formatMoney, formatDateTime } from '../lib/utils';
import { registrationFormDisplayRows } from '@/lib/registration-form';
import { Participant, Order } from '../types';
import { useEvent } from '../context/EventContext';
import { adminUserMessage } from '../lib/admin-user-message';

export const ParticipantDetailPage: React.FC = () => {
  const { eventId } = useEvent();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [participant, setParticipant] = useState<Participant | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      const p = await participantsService.getById(id, eventId);
      setParticipant(p);
      if (p?.order_id) {
        const o = await ordersService.getById(p.order_id);
        setOrder(o);
      }
      setLoading(false);
    }
    void load();
  }, [id, eventId]);

  const formRows = registrationFormDisplayRows(
    participant?.registration_form ||
      order?.registration?.form ||
      {},
  );

  const handleRevoke = async () => {
    if (!participant?.order_id) return;
    setRevoking(true);
    try {
      await ordersService.revokeAttendance(participant.order_id);
      success(
        'Inscrit retiré',
        'Les billets sont invalidés au scan. Les données restent visibles dans les exports CSV serveur.',
      );
      navigate('/participants');
    } catch (err) {
      toastError('Retrait impossible', adminUserMessage(err, 'Réessayez dans un instant.'));
    } finally {
      setRevoking(false);
      setRevokeOpen(false);
    }
  };

  const handleResend = async () => {
    if (!participant?.ticket_id) return;
    setResending(true);
    try {
      await ticketsService.resendEmail(participant.ticket_id);
      success('E-mail envoyé', `Le billet a été renvoyé à ${participant.email}.`);
    } catch (err) {
      toastError('Envoi impossible', adminUserMessage(err, 'Réessayez dans un instant.'));
    } finally {
      setResending(false);
    }
  };

  if (loading) {
    return <div className="p-12 text-center text-slate-400">Chargement du profil…</div>;
  }

  if (!participant) {
    return (
      <div className="p-12 text-center">
        <h2 className="text-xl font-bold text-slate-800">Inscription introuvable</h2>
        <button
          onClick={() => navigate('/participants')}
          className="mt-4 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold"
        >
          Retour aux inscriptions
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/participants')}
          className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shadow-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{participant.name}</h1>
          <p className="text-xs text-slate-500">Commande {participant.order_id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-violet-600 to-pink-600 text-white font-extrabold text-2xl flex items-center justify-center shadow-md shadow-violet-500/20">
              {participant.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">{participant.name}</h3>
              <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                <Mail className="w-3.5 h-3.5" /> {participant.email}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={participant.order_status} type="order" />
                {participant.is_revoked ? (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md">
                    Retiré (billets invalidés)
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 flex items-center gap-1.5 shrink-0">
                <Ticket className="w-4 h-4" /> Pass
              </span>
              <span className="font-semibold text-slate-800 text-right">{participant.pass_name}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 shrink-0">N° série</span>
              <span className="font-mono text-[11px] text-slate-700 text-right">{participant.serial}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 flex items-center gap-1.5 shrink-0">
                <Calendar className="w-4 h-4" /> Inscription
              </span>
              <span className="font-semibold text-slate-800">{formatDateTime(participant.issued_at)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 flex items-center gap-1.5 shrink-0">
                <ShieldCheck className="w-4 h-4 text-emerald-500" /> Admission
              </span>
              <span className="font-bold text-emerald-600">
                {participant.admitted ? 'Admis' : 'Non composté'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-400 shrink-0">Montant</span>
              <span className="font-bold text-slate-800">
                {formatMoney(participant.amount_minor, participant.currency)}
              </span>
            </div>
          </div>

          <button
            onClick={() => void handleResend()}
            disabled={resending || participant.is_revoked}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 disabled:opacity-60 font-semibold text-xs transition-colors"
          >
            <Send className="w-4 h-4" />
            {resending ? 'Envoi…' : 'Renvoyer le billet par e-mail'}
          </button>

          {participant.order_status === 'paid' && !participant.is_revoked ? (
            <button
              type="button"
              onClick={() => setRevokeOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 font-semibold text-xs transition-colors"
            >
              <UserX className="w-4 h-4" />
              Retirer l&apos;inscrit
            </button>
          ) : null}
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
          <h3 className="text-base font-bold text-slate-900 tracking-tight mb-4">
            Formulaire d&apos;inscription (complet)
          </h3>

          {formRows.length === 0 ? (
            <p className="text-sm text-slate-500 bg-slate-50 p-4 rounded-xl border border-slate-100">
              Aucune réponse détaillée enregistrée pour cette inscription. Les champs complets apparaissent pour
              les nouvelles inscriptions via le formulaire TDEV 2026.
              {(order?.motivation || order?.registration?.motivation) && (
                <>
                  <br />
                  <br />
                  <span className="font-semibold text-slate-700">Motivation (legacy) :</span>{' '}
                  {order?.registration?.motivation || order?.motivation}
                </>
              )}
            </p>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              {formRows.map((row) => (
                <div key={row.label} className={row.label === 'Attentes' ? 'sm:col-span-2' : ''}>
                  <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    {row.label}
                  </dt>
                  <dd className="text-slate-800 leading-relaxed bg-slate-50/80 px-3 py-2 rounded-lg border border-slate-100">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {revokeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-100"
            role="dialog"
            aria-labelledby="revoke-title"
          >
            <h2 id="revoke-title" className="text-lg font-bold text-slate-900">
              Retirer cet inscrit ?
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              Tous les billets valides seront invalidés : le QR ne passera plus au scan. L&apos;inscription
              disparaîtra de la liste par défaut et des Insights. Les exports CSV complets côté serveur
              conservent l&apos;historique.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRevokeOpen(false)}
                disabled={revoking}
                className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleRevoke()}
                disabled={revoking}
                className="px-4 py-2 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-60"
              >
                {revoking ? 'Retrait…' : 'Confirmer le retrait'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
