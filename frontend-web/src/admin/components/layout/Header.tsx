import React from 'react';
import { Menu, Search, LogOut, CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { adminPath, cn } from '../../lib/utils';

interface HeaderProps {
  onOpenSidebar: () => void;
  onOpenSearch: () => void;
}

function formatHeaderDate(): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
}

export const Header: React.FC<HeaderProps> = ({ onOpenSidebar, onOpenSearch }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-[#f4f5f7]/90 px-4 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex h-[4.25rem] max-w-[1400px] items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            className="rounded-xl p-2 text-zinc-600 hover:bg-white lg:hidden"
            aria-label="Menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onOpenSearch}
            className="hidden max-w-lg flex-1 items-center gap-2 rounded-2xl border border-zinc-200/80 bg-white px-4 py-2.5 text-left text-sm text-zinc-500 shadow-sm transition-colors hover:border-zinc-300 sm:flex"
          >
            <Search className="h-4 w-4 shrink-0 text-zinc-400" />
            Rechercher un inscrit, une commande…
          </button>
        </div>

        <div className="hidden items-center gap-2 text-xs font-medium text-zinc-500 md:flex">
          <CalendarDays className="h-4 w-4 text-zinc-400" />
          <span className="capitalize">{formatHeaderDate()}</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onOpenSearch}
            className="rounded-xl p-2 text-zinc-500 hover:bg-white sm:hidden"
            aria-label="Rechercher"
          >
            <Search className="h-5 w-5" />
          </button>
          <div className="hidden text-right sm:block">
            <p className="max-w-[140px] truncate text-sm font-medium text-zinc-900">
              {user?.name || 'Administrateur'}
            </p>
            <p className="max-w-[140px] truncate text-[11px] text-zinc-500">{user?.email}</p>
          </div>
          <span
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white',
            )}
          >
            {(user?.name || 'A').charAt(0).toUpperCase()}
          </span>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate(adminPath('/login'));
            }}
            title="Déconnexion"
            className="rounded-xl border border-zinc-200 bg-white p-2 text-zinc-600 shadow-sm hover:bg-zinc-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
