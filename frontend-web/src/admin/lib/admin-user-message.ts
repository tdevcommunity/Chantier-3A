import {
  isTechnicalUserMessage,
  logAdminApiDiagnostic,
  toUserFacingApiMessage,
} from './user-facing-api-error';

export const adminMessages = {
  genericRetry: 'Réessayez dans un instant.',
  actionDenied: 'Action non autorisée.',
  roleChangeDenied: 'Vous ne pouvez pas modifier ce rôle.',
  inviteFailed: 'Invitation impossible.',
  inviteCreatedEmail: (email: string) => `E-mail envoyé à ${email}.`,
  inviteCreatedClipboard:
    'Invitation créée. Lien copié dans le presse-papiers (e-mail non disponible).',
  exportNone: 'Aucune inscription à exporter.',
  exportFailed: 'Export impossible. Réessayez dans un instant.',
  exportSuccess: 'Le fichier a été téléchargé.',
  passDeleteBlocked: 'Ce pass a déjà des ventes. Fermez les ventes plutôt que de le supprimer.',
  passSaveFailed: 'Enregistrement impossible. Réessayez dans un instant.',
  loadTeamFailed: 'Impossible de charger l’équipe.',
  networkFailed: 'Connexion impossible. Réessayez dans un instant.',
  serviceUnavailable: 'Service temporairement indisponible. Réessayez dans un instant.',
} as const;

const ENGLISH_API_SNIPPETS: Record<string, string> = {
  forbidden: adminMessages.actionDenied,
  'you are not': adminMessages.actionDenied,
  'you cannot': adminMessages.roleChangeDenied,
  'invalid role': adminMessages.roleChangeDenied,
  'member not found': adminMessages.genericRetry,
  conflict: adminMessages.passDeleteBlocked,
  'ticket type has sales': adminMessages.passDeleteBlocked,
  request_failed: adminMessages.genericRetry,
  download_failed: adminMessages.exportFailed,
  empty_export: adminMessages.exportNone,
  network: adminMessages.networkFailed,
  service_unavailable: adminMessages.serviceUnavailable,
};

const FRENCH_KNOWN: Record<string, string> = {
  'connexion réseau impossible.': adminMessages.networkFailed,
  'service billetterie temporairement indisponible.': adminMessages.serviceUnavailable,
};

export function adminUserMessage(err: unknown, fallback: string): string {
  logAdminApiDiagnostic('ui', err);
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.trim().toLowerCase();

  for (const [needle, msg] of Object.entries(FRENCH_KNOWN)) {
    if (lower === needle) return msg;
  }
  for (const [needle, msg] of Object.entries(ENGLISH_API_SNIPPETS)) {
    if (lower.includes(needle)) return msg;
  }

  if (!isTechnicalUserMessage(raw)) {
    return raw.length > 120 ? fallback : raw;
  }

  return toUserFacingApiMessage(err, fallback);
}
