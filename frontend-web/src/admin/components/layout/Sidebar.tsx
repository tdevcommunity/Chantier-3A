import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Ticket,
  Sparkles,
  QrCode,
  Tags,
  X,
  ShoppingCart,
  Calendar,
  UserCog,
  BarChart3,
  Table2,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  adminSidebar,
  ADMIN_RAIL_WIDTH,
  ADMIN_SIDEBAR_WIDTH_EXPANDED,
} from '../../lib/admin-theme';
import { AdminTdevLogo } from '../brand/AdminTdevLogo';

const STORAGE_KEY = 'admin-sidebar-collapsed';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

type NavItem = { name: string; path: string; icon: LucideIcon };

const NAV_ITEMS: NavItem[] = [
  { name: 'Vue d’ensemble', path: 'dashboard', icon: LayoutDashboard },
  { name: 'Inscrits', path: 'participants', icon: Users },
  { name: 'Insights', path: 'insights', icon: BarChart3 },
  { name: 'Soumissions', path: 'submissions', icon: Table2 },
  { name: 'Commandes', path: 'orders', icon: ShoppingCart },
  { name: 'Billets', path: 'tickets', icon: Ticket },
  { name: 'Types de pass', path: 'ticket-types', icon: Tags },
  { name: 'Nexus Night', path: 'nexus-night', icon: Sparkles },
  { name: 'Scans', path: 'admissions', icon: QrCode },
  { name: 'Événement', path: 'event', icon: Calendar },
  { name: 'Équipe', path: 'team', icon: UserCog },
];

function pathMatches(pathname: string, segment: string): boolean {
  return pathname.endsWith(`/${segment}`) || pathname.includes(`/${segment}/`);
}

function NavItemLink({
  item,
  active,
  onNavigate,
  compact,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  compact: boolean;
}) {
  const Icon = item.icon;

  if (compact) {
    return (
      <div className="flex justify-center">
        <NavLink
          to={item.path}
          onClick={onNavigate}
          title={item.name}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-2xl transition-all duration-200',
            active ? adminSidebar.iconActive : adminSidebar.iconIdle,
          )}
          aria-label={item.name}
          aria-current={active ? 'page' : undefined}
        >
          <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={1.75} />
        </NavLink>
      </div>
    );
  }

  return (
    <NavLink
      to={item.path}
      onClick={onNavigate}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-white text-emerald-900 shadow-sm ring-1 ring-zinc-200/80'
          : 'text-zinc-600 hover:bg-white/70 hover:text-zinc-900',
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className="h-[1.15rem] w-[1.15rem] shrink-0" strokeWidth={1.75} />
      <span className="truncate">{item.name}</span>
    </NavLink>
  );
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  collapsed,
  onCollapsedChange,
}) => {
  const location = useLocation();
  const pathname = location.pathname;
  const desktopWidth = collapsed ? ADMIN_RAIL_WIDTH : ADMIN_SIDEBAR_WIDTH_EXPANDED;

  const onNavigate = () => {
    if (window.innerWidth < 1024) onClose();
  };

  return (
    <>
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-zinc-900/30 backdrop-blur-[2px] lg:hidden"
          aria-hidden
        />
      )}

      {/* Desktop */}
      <aside
        style={{ width: desktopWidth }}
        className={cn(
          'admin-sidebar-rail fixed inset-y-0 left-0 z-50 hidden flex-col overflow-hidden transition-[width] duration-300 ease-out lg:flex',
          adminSidebar.shell,
          collapsed ? 'pt-4' : 'pt-4 pb-4',
        )}
      >
        <div className={cn('mb-4 shrink-0', collapsed ? 'px-3' : 'px-4')}>
          <NavLink to="dashboard" title="TDEV Admin">
            {collapsed ? (
              <AdminTdevLogo variant="onLight" size="sm" className="justify-start" />
            ) : (
              <AdminTdevLogo
                variant="onLight"
                size="md"
                withTitle
                subtitle="Administration"
                className="min-w-0"
              />
            )}
          </NavLink>
        </div>

        <nav
          className={cn(
            'admin-sidebar-scroll flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden pb-2',
            collapsed ? 'items-center px-2' : 'px-3',
          )}
        >
          {NAV_ITEMS.map((item) => (
            <NavItemLink
              key={item.path}
              item={item}
              active={pathMatches(pathname, item.path)}
              compact={collapsed}
            />
          ))}
        </nav>

        <button
          type="button"
          onClick={() => onCollapsedChange(!collapsed)}
          className="absolute -right-3 top-[4.75rem] flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-md transition-colors hover:bg-zinc-50"
          aria-label={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
      </aside>

      {/* Mobile */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(100%,280px)] flex-col transition-transform duration-300 lg:hidden',
          adminSidebar.mobileShell,
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-zinc-100 px-4">
          <AdminTdevLogo variant="onLight" size="md" withTitle subtitle="Admin" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="admin-sidebar-scroll flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-3">
          {NAV_ITEMS.map((item) => (
            <NavItemLink
              key={item.path}
              item={item}
              active={pathMatches(pathname, item.path)}
              onNavigate={onNavigate}
              compact={false}
            />
          ))}
        </nav>
      </aside>
    </>
  );
};

export function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return true;
  return stored === '1';
}

export function persistSidebarCollapsed(collapsed: boolean) {
  window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
}

export { ADMIN_RAIL_WIDTH as ADMIN_SIDEBAR_WIDTH_COLLAPSED, ADMIN_SIDEBAR_WIDTH_EXPANDED };
