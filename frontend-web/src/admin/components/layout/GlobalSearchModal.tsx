import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Users, ShoppingCart, Ticket, Calendar, ArrowRight } from 'lucide-react';
import { participantsService } from '../../services/participants.service';
import { ordersService } from '../../services/orders.service';
import { ticketsService } from '../../services/tickets.service';
import { useEvent } from '../../context/EventContext';
import { formatMoney } from '../../lib/utils';
import { AdminTdevLogo } from '../brand/AdminTdevLogo';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GlobalSearchModal: React.FC<GlobalSearchModalProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{
    participants: any[];
    orders: any[];
    tickets: any[];
    events: any[];
  }>({ participants: [], orders: [], tickets: [], events: [] });
  
  const navigate = useNavigate();
  const { eventId } = useEvent();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults({ participants: [], orders: [], tickets: [], events: [] });
    }
  }, [isOpen]);

  useEffect(() => {
    const searchTimer = setTimeout(async () => {
      if (!query || query.length < 2) {
        setResults({ participants: [], orders: [], tickets: [], events: [] });
        return;
      }
      setLoading(true);
      try {
        const [p, o, t] = await Promise.all([
          participantsService.getAll({ search: query, limit: 8, includeRevoked: true }, eventId),
          ordersService.getAll({ search: query, limit: 5 }, eventId),
          ticketsService.getAll({ search: query }, eventId),
        ]);
        
        const filteredTickets = t.slice(0, 5);

        setResults({
          participants: p.data,
          orders: o.data,
          tickets: filteredTickets,
          events: [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => clearTimeout(searchTimer);
  }, [query, eventId]);

  if (!isOpen) return null;

  const navigateTo = (path: string) => {
    navigate(path);
    onClose();
  };

  const hasResults =
    results.participants.length > 0 ||
    results.orders.length > 0 ||
    results.tickets.length > 0 ||
    results.events.length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 sm:pt-32 px-4">
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={onClose} />
      
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden ring-1 ring-slate-900/5 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center px-4 py-4 border-b border-slate-100">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            type="text"
            className="flex-1 bg-transparent border-0 px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 h-8"
            placeholder="Rechercher participants, commandes, billets..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {loading ? (
            <div className="w-5 h-5 rounded-full border-2 border-slate-200 border-t-violet-600 animate-spin shrink-0" />
          ) : (
            <button onClick={onClose} className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 shrink-0">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {query.length > 1 && (
          <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
            {!hasResults && !loading ? (
              <div className="py-12 text-center text-sm text-slate-500">
                Aucun résultat trouvé pour "{query}"
              </div>
            ) : (
              <>
                {results.participants.length > 0 && (
                  <div className="p-2">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2">
                      Participants
                    </h3>
                    <div className="space-y-1">
                      {results.participants.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => navigateTo(`/participants/${p.id}`)}
                          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                              <Users className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-900">{p.name}</div>
                              <div className="text-xs text-slate-500">{p.email} • {p.pass_name}</div>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {results.orders.length > 0 && (
                  <div className="p-2 border-t border-slate-100">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2">
                      Commandes
                    </h3>
                    <div className="space-y-1">
                      {results.orders.map((o) => (
                        <button
                          key={o.id}
                          onClick={() => navigateTo(`/orders/${o.id}`)}
                          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-violet-100 text-violet-600 flex items-center justify-center shrink-0">
                              <ShoppingCart className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-900">Commande {o.id.substring(0, 8)}</div>
                              <div className="text-xs text-slate-500">{o.buyer_name} • {formatMoney(o.total_minor, o.currency)}</div>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {results.tickets.length > 0 && (
                  <div className="p-2 border-t border-slate-100">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-2">
                      Billets
                    </h3>
                    <div className="space-y-1">
                      {results.tickets.map((t) => (
                        <button
                          key={t.serial}
                          onClick={() => navigateTo(`/tickets`)}
                          className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group text-left"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                              <Ticket className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-sm font-medium text-slate-900">{t.serial}</div>
                              <div className="text-xs text-slate-500">{t.holder_name}</div>
                            </div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        
        {query.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            Commencez à taper pour rechercher...
          </div>
        )}
        
        <div className="bg-slate-50 px-4 py-3 border-t border-slate-100 text-xs text-slate-500 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-white shadow-sm font-medium">ESC</span> pour fermer
          </div>
          <AdminTdevLogo variant="onLight" size="sm" />
        </div>
      </div>
    </div>
  );
};
