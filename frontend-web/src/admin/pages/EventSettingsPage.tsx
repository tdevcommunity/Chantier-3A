import React, { useEffect, useState } from 'react';
import { PageHeader } from '../components/ui/PageHeader';
import { eventsService } from '../services/events.service';
import { useEvent } from '../context/EventContext';
import { useToast } from '../context/ToastContext';
import { Event } from '../types';
import { ErrorState } from '../components/ui/FeedbackStates';
import { adminUserMessage } from '../lib/admin-user-message';

export const EventSettingsPage: React.FC = () => {
  const { eventId, loading: eventLoading, error: eventError } = useEvent();
  const { success, error } = useToast();
  const [event, setEvent] = useState<Event | null>(null);
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    eventsService.getCurrent(eventId).then((ev) => {
      if (!ev) return;
      setEvent(ev);
      setTitle(ev.title || '');
      setVenue(ev.venue_name || '');
      setAddress(ev.address || '');
      setDescription(ev.description || '');
    });
  }, [eventId]);

  if (eventLoading) {
    return <div className="p-12 text-center text-slate-400">Chargement…</div>;
  }
  if (eventError || !eventId) {
    return <ErrorState message={eventError || 'Événement introuvable.'} onRetry={() => window.location.reload()} />;
  }

  const save = async () => {
    setSaving(true);
    try {
      const updated = await eventsService.update(eventId, {
        title,
        venue_name: venue,
        address,
        description,
      });
      setEvent(updated);
      success('Événement', 'Modifications enregistrées.');
    } catch (err: unknown) {
      error('Enregistrement', adminUserMessage(err, 'Impossible de sauvegarder.'));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    try {
      const updated = await eventsService.publish(eventId);
      setEvent(updated);
      success('Publication', 'L’événement est publié.');
    } catch (err: unknown) {
      error('Publication', adminUserMessage(err, 'Publication impossible.'));
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Événement" subtitle="Informations affichées sur la billetterie et les billets" />
      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm space-y-4">
        <label className="block text-sm font-semibold">
          Titre
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
        <label className="block text-sm font-semibold">
          Lieu
          <input
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
        <label className="block text-sm font-semibold">
          Adresse
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
        <label className="block text-sm font-semibold">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5"
          />
        </label>
        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-green-800 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            Enregistrer
          </button>
          {event?.status !== 'published' && (
            <button
              type="button"
              onClick={publish}
              className="rounded-xl border border-green-800 px-5 py-2.5 text-sm font-bold text-green-900"
            >
              Publier
            </button>
          )}
        </div>
        {event?.status && (
          <p className="text-xs text-slate-500">Statut actuel : {event.status}</p>
        )}
      </div>
    </div>
  );
};
