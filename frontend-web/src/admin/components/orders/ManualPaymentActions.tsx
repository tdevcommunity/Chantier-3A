import React, { useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { ordersService } from '../../services/orders.service';
import { useToast } from '../../context/ToastContext';
import { adminUserMessage } from '../../lib/admin-user-message';
import { formatMoney } from '../../lib/utils';
import { Order } from '../../types';

/** Commande déclarée par le client via paiement manuel et pas encore traitée par l'équipe. */
export function isToVerify(order: Pick<Order, 'status' | 'manual_payment'>): boolean {
  return order.status === 'pending' && !!order.manual_payment?.reference;
}

export const OPERATOR_LABELS: Record<string, string> = {
  xpress: 'Xpress',
  mixx_by_yas: 'Mixx By Yas',
  moov_money: 'Moov Money',
};

interface ManualPaymentActionsProps {
  order: Order;
  /** Appelé après validation ou rejet réussi, avec la commande mise à jour. */
  onDone: (updated: Order) => void;
  compact?: boolean;
}

type Mode = 'validate' | 'reject' | null;

export const ManualPaymentActions: React.FC<ManualPaymentActionsProps> = ({ order, onDone, compact }) => {
  const { success, error } = useToast();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isToVerify(order)) return null;

  const close = () => {
    if (busy) return;
    setMode(null);
    setReason('');
  };

  const run = async () => {
    setBusy(true);
    try {
      if (mode === 'validate') {
        const res = await ordersService.validateManual(order.id);
        success('Paiement validé', `Confirmation et billet envoyés à ${order.buyer_email}.`);
        onDone(res.order);
      } else if (mode === 'reject') {
        const res = await ordersService.rejectManual(order.id, reason.trim());
        success('Paiement rejeté', `${order.buyer_email} a été prévenu par e-mail.`);
        onDone(res.order);
      }
      setMode(null);
      setReason('');
    } catch (err) {
      error('Action impossible', adminUserMessage(err, 'Réessayez dans un instant.'));
    } finally {
      setBusy(false);
    }
  };

  const btn = compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2 text-xs';

  return (
    <>
      <div className={compact ? 'inline-flex flex-col items-stretch gap-1' : 'inline-flex items-center gap-1.5'}>
        <button
          type="button"
          onClick={() => setMode('validate')}
          className={`${btn} inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors`}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          Valider
        </button>
        <button
          type="button"
          onClick={() => setMode('reject')}
          className={`${btn} inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 font-semibold transition-colors`}
        >
          <XCircle className="w-3.5 h-3.5" />
          Rejeter
        </button>
      </div>

      {mode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            e.stopPropagation();
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl text-left">
            <h3 className="text-base font-bold text-slate-900">
              {mode === 'validate' ? 'Valider ce paiement ?' : 'Rejeter ce paiement ?'}
            </h3>

            <dl className="space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Acheteur</dt>
                <dd className="font-semibold">{order.buyer_name || order.buyer_email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Opérateur</dt>
                <dd className="font-semibold">
                  {OPERATOR_LABELS[order.manual_payment?.operator ?? ''] ?? order.manual_payment?.operator}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Référence déclarée</dt>
                <dd className="font-mono font-bold">{order.manual_payment?.reference}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">N° émetteur</dt>
                <dd className="font-mono">{order.manual_payment?.phone}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-400">Montant à avoir reçu</dt>
                <dd className="font-bold">{formatMoney(order.total_minor, order.currency)}</dd>
              </div>
            </dl>

            {mode === 'validate' ? (
              <p className="text-xs text-slate-600">
                Vérifiez d&apos;abord que ce montant, avec cette référence, est bien arrivé sur le compte marchand.
                La validation envoie <strong>immédiatement</strong> l&apos;e-mail de confirmation et le billet.
              </p>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="reject-reason" className="text-xs font-semibold text-slate-700">
                  Motif du rejet (envoyé au client)
                </label>
                <textarea
                  id="reject-reason"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex : référence introuvable, montant insuffisant…"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                />
                <p className="text-[11px] text-slate-400">
                  La commande sera annulée et la place remise en vente.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy || (mode === 'reject' && !reason.trim())}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-50 ${
                  mode === 'validate' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {mode === 'validate' ? 'Valider et envoyer le billet' : 'Rejeter et prévenir le client'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
