import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, ScanLine, Users } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/FeedbackStates';
import { participantsService } from '../services/participants.service';
import { exportsService } from '../services/exports.service';
import { formatDateTime, formatMoney } from '../lib/utils';
import { Participant } from '../types';
import { useEvent } from '../context/EventContext';
import { adminUserMessage } from '../lib/admin-user-message';

export const NexusNightPage: React.FC = () => {
  const { eventId } = useEvent();
  const [participants, setParticipants] = useState<Participant[]>([]); const [loading, setLoading] = useState(true); const [failure, setFailure] = useState<string | null>(null);
  const load = async () => {
    try {
      setLoading(true);
      setFailure(null);
      const result = await participantsService.getAll({ nexus: true, limit: 10000 }, eventId);
      setParticipants(result.data);
    } catch (error: unknown) {
      setFailure(adminUserMessage(error, 'Impossible de lire les données Nexus Night.'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [eventId]);
  const paid = participants.filter((participant) => participant.order_status === 'paid');
  const admitted = participants.filter((participant) => participant.admitted);
  const revenue = paid.reduce((sum, participant) => sum + (participant.amount_minor || 0), 0);
  return <div className="space-y-5"><PageHeader title="Nexus Night" subtitle="Suivi en direct des pass payants et des admissions"><button onClick={() => exportsService.downloadServerCsv('participants', eventId)} className="flex items-center gap-2 rounded-xl border border-green-200 bg-white px-3.5 py-2 text-xs font-semibold text-green-800"><Download className="h-4 w-4" />Exporter CSV</button></PageHeader>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3"><StatCard title="Pass Nexus" value={participants.length} icon={<Users className="h-5 w-5 text-white" />} iconBgColor="bg-green-900" /><StatCard title="Paiements confirmés" value={paid.length} icon={<CheckCircle2 className="h-5 w-5 text-white" />} iconBgColor="bg-green-700" /><StatCard title="Revenus Nexus" value={formatMoney(revenue, participants[0]?.currency || 'XOF')} icon={<ScanLine className="h-5 w-5 text-white" />} iconBgColor="bg-green-600" comparison={`${admitted.length} accès scannés`} /></div>
    {loading ? <TableSkeleton rows={5} /> : failure ? <ErrorState message={failure} onRetry={load} /> : participants.length === 0 ? <EmptyState title="Aucun pass Nexus Night enregistré." /> : <div className="overflow-hidden rounded-2xl border border-green-100 bg-white shadow-sm"><div className="border-b border-green-100 p-5"><h3 className="font-bold text-green-950">Détenteurs du pass Nexus Night</h3><p className="mt-1 text-xs text-green-700">Participants inscrits à la soirée Nexus Night.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-green-50 text-green-800"><tr><th className="px-5 py-3">Participant</th><th className="px-5 py-3">Billet</th><th className="px-5 py-3">Paiement</th><th className="px-5 py-3">Entrée</th><th className="px-5 py-3 text-right">Inscription</th></tr></thead><tbody className="divide-y divide-green-50">{participants.map((p) => <tr key={p.id} className="text-green-900"><td className="px-5 py-4"><b>{p.name}</b><span className="mt-1 block text-green-700">{p.email}</span></td><td className="px-5 py-4 font-mono">{p.serial}</td><td className="px-5 py-4">{p.order_status === 'paid' ? 'Confirmé' : 'En attente'}</td><td className="px-5 py-4">{p.admitted ? 'Scanné' : 'Non scanné'}</td><td className="px-5 py-4 text-right text-green-700">{formatDateTime(p.issued_at)}</td></tr>)}</tbody></table></div></div>}</div>;
};
