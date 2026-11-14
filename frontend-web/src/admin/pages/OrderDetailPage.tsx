import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ShoppingCart,
  User,
  Mail,
  School,
  Calendar,
  CreditCard,
  Send,
  RefreshCw,
  Tag,
} from 'lucide-react';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ManualPaymentActions, OPERATOR_LABELS, isToVerify } from '../components/orders/ManualPaymentActions';
import { ordersService } from '../services/orders.service';
import { ticketsService } from '../services/tickets.service';
import { adminUserMessage } from '../lib/admin-user-message';
import { useToast } from '../context/ToastContext';
import { adminPath, formatMoney, formatDateTime } from '../lib/utils';
import { Order } from '../types';

export const OrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [resending, setResending] = useState(false);

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!id) return;
      setLoading(true);
      const o = await ordersService.getById(id);
      setOrder(o);
      setLoading(false);
    }
    load();
  }, [id]);

  const handleResend = async () => {
    if (!order) return;
    const ticketId = order.tickets?.[0]?.id;
    if (!ticketId) {
      error('Envoi impossible', 'Aucun billet émis pour cette commande.');
      return;
    }
    setResending(true);
    try {
      await ticketsService.resendEmail(ticketId);
      success('E-mail en cours d’envoi', `Confirmation et billet renvoyés à ${order.buyer_email}.`);
    } catch (err) {
      error('Envoi impossible', adminUserMessage(err, 'Réessayez dans un instant.'));
    } finally {
      setResending(false);
    }
  };

  /** Après validation/rejet : recharge la commande complète (inscription incluse). */
  const reload = async (fallback: Order) => {
    const fresh = id ? await ordersService.getById(id) : null;
    setOrder(fresh ?? fallback);
  };

  if (loading) {
    return <div className="p-12 text-center text-slate-400">Chargement de la commande...</div>;
  }

  if (!order) {
    return (
      <div className="p-12 text-center">
        <h2 className="text-xl font-bold text-slate-800">Commande introuvable</h2>
        <button
          onClick={() => navigate(adminPath('/orders'))}
          className="mt-4 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold"
        >
          Retour aux commandes
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(adminPath('/orders'))}
          className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shadow-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Détail Commande : {order.id}
          </h1>
          <p className="text-xs text-slate-500">
            Enregistrée le {formatDateTime(order.created_at)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Buyer information */}
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h3 className="text-base font-bold text-slate-900">Acheteur</h3>
            <StatusBadge status={isToVerify(order) ? 'to_verify' : order.status} type="order" />
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <span className="text-slate-400 block mb-0.5">Nom complet</span>
              <span className="font-bold text-slate-800 text-sm">{order.buyer_name}</span>
            </div>

            <div>
              <span className="text-slate-400 block mb-0.5">Adresse e-mail</span>
              <span className="font-medium text-slate-700">{order.buyer_email}</span>
            </div>

            <div>
              <span className="text-slate-400 block mb-0.5">École / Université</span>
              <span className="font-medium text-slate-700">
                {order.registration?.school_name ||
                  order.school_name ||
                  String(order.registration?.form?.school_program ?? '') ||
                  'Non spécifié'}
              </span>
            </div>
          </div>

          {order.status === 'paid' && (
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <button
                onClick={() => void handleResend()}
                disabled={resending}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
              >
                <Send className="w-4 h-4 text-slate-400" />
                {resending ? 'Envoi…' : 'Renvoyer la confirmation'}
              </button>
            </div>
          )}
        </div>

        {/* Payment & Items breakdown */}
        <div className="lg:col-span-2 space-y-6">
          {/* Financial summary card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
            <h3 className="text-base font-bold text-slate-900 mb-4">
              Informations de Paiement
            </h3>

            {isToVerify(order) && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                <p className="max-w-md leading-relaxed">
                  <strong>Paiement à vérifier.</strong> Contrôlez sur le compte marchand la réception de{' '}
                  {formatMoney(order.total_minor, order.currency)} avec la référence ci-dessous, puis validez
                  (billet et e-mail partent immédiatement) ou rejetez avec un motif.
                </p>
                <ManualPaymentActions order={order} onDone={(updated) => void reload(updated)} />
              </div>
            )}
            {order.status === 'failed' && order.manual_payment?.rejection_reason && (
              <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
                <strong>Paiement rejeté</strong>
                {order.manual_payment.verified_by ? ` par ${order.manual_payment.verified_by}` : ''} :{' '}
                {order.manual_payment.rejection_reason}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs mb-6">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Montant Total</span>
                <span className="font-extrabold text-slate-900 text-sm">
                  {formatMoney(order.total_minor, order.currency)}
                </span>
                {order.fee_minor > 0 && (
                  <span className="block mt-0.5 text-[10px] text-slate-400">
                    {formatMoney(order.subtotal_minor, order.currency)} + {formatMoney(order.fee_minor, order.currency)} de frais de retrait
                  </span>
                )}
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">
                  {order.manual_payment ? 'Opérateur' : 'Passerelle'}
                </span>
                <span className="font-bold text-slate-800">
                  {order.manual_payment
                    ? OPERATOR_LABELS[order.manual_payment.operator] ?? order.manual_payment.operator
                    : (order.provider || '—').toUpperCase()}
                </span>
                {order.manual_payment?.phone && (
                  <span className="block mt-0.5 font-mono text-[10px] text-slate-400">
                    depuis {order.manual_payment.phone}
                  </span>
                )}
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Référence</span>
                <span className="font-mono text-slate-700 font-semibold truncate block">
                  {order.manual_payment?.reference || order.provider_ref || '—'}
                </span>
              </div>

              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block mb-1">Paiement Validé</span>
                <span className="font-medium text-slate-700">
                  {formatDateTime(order.paid_at)}
                </span>
              </div>
            </div>

            {/* Motivation from order */}
            {(order.registration?.motivation || order.motivation) && (
              <div className="mt-4 pt-4 border-t border-slate-100 text-xs">
                <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">
                  Motivation de l&apos;acheteur
                </span>
                <p className="text-slate-700 italic">
                  « {order.registration?.motivation || order.motivation} »
                </p>
              </div>
            )}
            {(order.registration?.form && Object.keys(order.registration.form).length > 0) && (
              <div className="mt-4 pt-4 border-t border-slate-100 text-xs">
                <button
                  type="button"
                  onClick={() => navigate(adminPath(`/participants/${order.id}`))}
                  className="text-violet-600 font-semibold hover:underline"
                >
                  Voir le formulaire d&apos;inscription complet
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
