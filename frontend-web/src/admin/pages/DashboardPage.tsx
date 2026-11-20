import React, { useState, useEffect } from 'react';
import {
  Users,
  Ticket,
  Sparkles,
  ScanLine,
  Download,
  Clock,
  ShoppingBag,
} from 'lucide-react';
import { StatCard } from '../components/ui/StatCard';
import { SalesAreaChart } from '../components/dashboard/SalesAreaChart';
import { TicketDonutChart } from '../components/dashboard/TicketDonutChart';
import { PassesProgressCard } from '../components/dashboard/PassesProgressCard';
import { RecentOrdersTable } from '../components/dashboard/RecentOrdersTable';
import { dashboardService } from '../services/dashboard.service';
import { ticketTypesService } from '../services/ticket-types.service';
import { ordersService } from '../services/orders.service';
import { exportsService } from '../services/exports.service';
import { useAuth } from '../context/AuthContext';
import { useEvent } from '../context/EventContext';
import { useToast } from '../context/ToastContext';
import { formatMoney } from '../lib/utils';
import { adminTheme } from '../lib/admin-theme';
import { cn } from '../lib/utils';
import { DashboardKPIData, TicketType, Order } from '../types';

function MiniInsightCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={cn(adminTheme.card, 'flex items-start gap-3 p-4')}>
      <div className="rounded-xl bg-zinc-100 p-2 text-zinc-600">{icon}</div>
      <div>
        <p className="text-xs font-medium text-zinc-500">{title}</p>
        <p className="text-xl font-semibold tabular-nums text-zinc-900">{value}</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">{hint}</p>
      </div>
    </div>
  );
}

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { eventId } = useEvent();
  const { success, error } = useToast();

  const [kpis, setKpis] = useState<DashboardKPIData | null>(null);
  const [salesData, setSalesData] = useState<any[]>([]);
  const [distribution, setDistribution] = useState<any[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        setLoading(true);
        const kpiRes = await dashboardService.getKPIs(eventId);
        setKpis(kpiRes);
        const results = await Promise.allSettled([
          dashboardService.getSalesChart(eventId),
          dashboardService.getTicketDistribution(eventId),
          ticketTypesService.getAll(eventId),
          ordersService.getAll({ limit: 10 }, eventId),
        ]);
        if (results[0].status === 'fulfilled') setSalesData(results[0].value);
        if (results[1].status === 'fulfilled') setDistribution(results[1].value);
        if (results[2].status === 'fulfilled') {
          setTicketTypes(results[2].value.filter((tt) => tt.product_kind !== 'goodie'));
        }
        if (results[3].status === 'fulfilled') setOrders(results[3].value.data);
      } catch (err) {
        console.error('Error loading dashboard', err);
        error('Données indisponibles', 'Impossible de charger les statistiques.');
      } finally {
        setLoading(false);
      }
    }
    if (!eventId) return;
    loadDashboard();
  }, [error, eventId]);

  const handleExport = async () => {
    try {
      await exportsService.downloadServerCsv('participants', eventId);
      success('Export terminé', 'Le fichier CSV des inscrits a été téléchargé.');
    } catch {
      error('Export impossible', 'Les données n’ont pas pu être téléchargées.');
    }
  };

  const firstName = user?.name ? user.name.split(' ')[0] : 'Admin';

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className={adminTheme.pageTitle}>Bonjour, {firstName}</h1>
          <p className={adminTheme.pageSubtitle}>
            Suivez inscriptions, soirée Nexus et contrôles d’entrée
          </p>
        </div>
        <button type="button" onClick={handleExport} className={adminTheme.btnSecondary}>
          <Download className="h-4 w-4 text-zinc-500" />
          Exporter le rapport
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          variant="hero"
          className="xl:col-span-2"
          title="Participants"
          value={loading ? '…' : (kpis?.participants_count || 0).toLocaleString('fr-FR')}
          icon={<Users className="h-5 w-5" />}
          loading={loading}
        />
        <StatCard
          title="Billets émis"
          value={loading ? '…' : (kpis?.tickets_sold || 0).toLocaleString('fr-FR')}
          icon={<Ticket className="h-5 w-5" />}
          loading={loading}
        />
        <StatCard
          title="Nexus Night"
          value={loading ? '…' : (kpis?.nexus_night_count || 0).toLocaleString('fr-FR')}
          icon={<Sparkles className="h-5 w-5" />}
          comparison={
            kpis ? formatMoney(kpis.nexus_night_revenue_minor, kpis.currency || 'XOF') : undefined
          }
          trendLabel="Revenus"
          loading={loading}
        />
        <StatCard
          title="Scans"
          value={loading ? '…' : (kpis?.scans_total || 0).toLocaleString('fr-FR')}
          icon={<ScanLine className="h-5 w-5" />}
          loading={loading}
        />
        <StatCard
          title="En attente"
          value={loading ? '…' : (kpis?.pending_orders_count || 0).toLocaleString('fr-FR')}
          icon={<Clock className="h-5 w-5" />}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalesAreaChart data={salesData} />
        </div>
        <div className="flex flex-col gap-4">
          <TicketDonutChart data={distribution} total={kpis?.tickets_sold || 0} />
          <MiniInsightCard
            title="Commandes récentes"
            value={loading ? '…' : orders.length}
            hint="Derniers flux affichés ci-dessous"
            icon={<ShoppingBag className="h-4 w-4" />}
          />
        </div>
      </div>

      <PassesProgressCard ticketTypes={ticketTypes} />

      <RecentOrdersTable orders={orders} />
    </div>
  );
};
