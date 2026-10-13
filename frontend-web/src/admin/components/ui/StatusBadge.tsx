import React from 'react';
import { cn } from '../../lib/utils';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Ban,
} from 'lucide-react';

interface StatusBadgeProps {
  status: string;
  type?: 'order' | 'ticket' | 'admission' | 'event' | 'email' | 'sync' | 'generic';
  className?: string;
  showIcon?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  className,
  showIcon = true,
}) => {
  const norm = (status || '').toLowerCase();

  let label = status;
  let bgClass = 'bg-slate-100 text-slate-700 border-slate-200';
  let IconComponent: React.ReactNode = null;

  switch (norm) {
    // Succès / Valide / Payé / Admis
    case 'paid':
    case 'approved':
      label = 'Payé';
      bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      IconComponent = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      break;
    case 'valid':
      label = 'Valide';
      bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      IconComponent = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      break;
    case 'admitted':
      label = 'Admis';
      bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      IconComponent = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      break;
    case 'published':
      label = 'Publié';
      bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      IconComponent = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      break;
    case 'sent':
      label = 'Envoyé';
      bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      IconComponent = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      break;
    case 'ok':
    case 'synced':
      label = 'Synchronisé';
      bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      IconComponent = <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />;
      break;

    // En attente / Draft
    case 'pending':
    case 'processing':
      label = 'En attente';
      bgClass = 'bg-sky-50 text-sky-700 border-sky-200';
      IconComponent = <Clock className="w-3.5 h-3.5 text-sky-600" />;
      break;
    case 'draft':
      label = 'Brouillon';
      bgClass = 'bg-slate-100 text-slate-700 border-slate-300';
      IconComponent = <Clock className="w-3.5 h-3.5 text-slate-500" />;
      break;
    case 'not_scanned':
      label = 'Non composté';
      bgClass = 'bg-sky-50 text-sky-700 border-sky-200';
      IconComponent = <Clock className="w-3.5 h-3.5 text-sky-600" />;
      break;

    // Avertissement / Doublon / Mauvais événement
    case 'duplicate':
      label = 'Doublon';
      bgClass = 'bg-amber-50 text-amber-700 border-amber-200';
      IconComponent = <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />;
      break;
    case 'wrong_event':
      label = 'Autre événement';
      bgClass = 'bg-purple-50 text-purple-700 border-purple-200';
      IconComponent = <AlertTriangle className="w-3.5 h-3.5 text-purple-600" />;
      break;
    case 'refunded':
      label = 'Remboursé';
      bgClass = 'bg-amber-50 text-amber-700 border-amber-200';
      IconComponent = <RefreshCw className="w-3.5 h-3.5 text-amber-600" />;
      break;

    // Erreur / Invalide / Échoué / Annulé
    case 'failed':
      label = 'Échoué';
      bgClass = 'bg-rose-50 text-rose-700 border-rose-200';
      IconComponent = <XCircle className="w-3.5 h-3.5 text-rose-600" />;
      break;
    case 'invalid':
      label = 'Invalide';
      bgClass = 'bg-rose-50 text-rose-700 border-rose-200';
      IconComponent = <XCircle className="w-3.5 h-3.5 text-rose-600" />;
      break;
    case 'void':
      label = 'Annulé';
      bgClass = 'bg-rose-50 text-rose-700 border-rose-200';
      IconComponent = <Ban className="w-3.5 h-3.5 text-rose-600" />;
      break;
    case 'cancelled':
      label = 'Annulé';
      bgClass = 'bg-rose-50 text-rose-700 border-rose-200';
      IconComponent = <XCircle className="w-3.5 h-3.5 text-rose-600" />;
      break;
    default:
      label = status;
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border",
        bgClass,
        className
      )}
    >
      {showIcon && IconComponent}
      <span>{label}</span>
    </span>
  );
};
