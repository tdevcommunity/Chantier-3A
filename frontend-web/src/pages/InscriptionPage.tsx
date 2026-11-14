import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { ManualPaymentValue } from '@/components/registration/ManualPaymentStep';
import { RegistrationWizard } from '@/components/registration/RegistrationWizard';
import { PASS_TIER_PRICE_MINOR } from '@/lib/festival-storefront';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { resolveLiveCheckoutProduct } from '@/lib/billetterie-storefront';
import { completeCheckout } from '@/lib/billetterie-checkout';
import { clearRegistrationDraft, type RegistrationFormValues } from '@/lib/registration-form';
import {
  applyPartnerAccentFromQuery,
  isEmbedMode,
  notifyEmbedParent,
  resolveInscriptionListing,
} from '@/lib/inscription-entry';
import { checkoutFailureCopy, logCheckoutDiagnostic } from '@/lib/user-facing-checkout-error';
import { downloadGuestTicketPdfForOrder } from '@/lib/download-guest-ticket-pdf';
import { StorefrontBrandHomeLink } from '@/components/storefront/StorefrontBrandHomeLink';
import type { BilletterieListingProduct } from '@/lib/static-billetterie-catalog';

export default function InscriptionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const embed = isEmbedMode(searchParams);
  const parentOrigin = searchParams.get('parentOrigin');

  const listing = useMemo(
    () => resolveInscriptionListing(location.pathname, searchParams),
    [location.pathname, searchParams],
  );

  const [wizardKey, setWizardKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [successTitle, setSuccessTitle] = useState('');
  const [successBody, setSuccessBody] = useState('');
  const [successTicket, setSuccessTicket] = useState<{ orderId: string; email: string } | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [failureOpen, setFailureOpen] = useState(false);
  const [failureTitle, setFailureTitle] = useState('');
  const [failureBody, setFailureBody] = useState('');

  useEffect(() => {
    if (embed) applyPartnerAccentFromQuery(searchParams);
  }, [embed, searchParams]);

  useEffect(() => {
    setWizardKey((k) => k + 1);
  }, [listing?.listingId]);

  const showSuccess = (
    title: string,
    body: string,
    ticketDownload?: { orderId: string; email: string } | null,
  ) => {
    clearRegistrationDraft();
    setSuccessTitle(title);
    setSuccessBody(body);
    setSuccessTicket(ticketDownload ?? null);
    setSuccessOpen(true);
    notifyEmbedParent('tdev-inscription-success', { title, body }, parentOrigin);
  };

  const showFailure = (err: unknown, context = 'checkout') => {
    logCheckoutDiagnostic(context, err);
    const copy = checkoutFailureCopy(err);
    setFailureTitle(copy.title);
    setFailureBody(copy.body);
    setFailureOpen(true);
  };

  const handleSubmit = async (
    values: RegistrationFormValues,
    active: BilletterieListingProduct,
    manualPayment?: ManualPaymentValue,
  ) => {
    const passTitle = active.title;
    setSubmitting(true);
    try {
      const live = await resolveLiveCheckoutProduct(active.checkoutTier!);
      const outcome = await completeCheckout({
        eventId: live.event.id,
        ticketType: live.product.ticketType,
        registration: values,
        manualPayment,
      });

      if (outcome.kind === 'free_confirmed') {
        showSuccess(
          'Inscription réussie',
          `Merci ! Votre inscription au ${passTitle} est confirmée. Vous recevrez votre billet par e-mail à ${outcome.email} dans quelques instants.`,
          { orderId: outcome.orderId, email: outcome.email },
        );
        return;
      }

      showSuccess(
        'Paiement déclaré — en attente de validation',
        `Merci ! Nous avons bien reçu votre déclaration de paiement pour le ${passTitle}. Notre équipe va vérifier votre transfert. Votre confirmation et votre billet seront envoyés à ${outcome.email} dès que votre paiement sera validé. Pensez à vérifier vos spams.`,
      );
    } catch (err) {
      showFailure(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadTicket = async () => {
    if (!successTicket) return;
    setDownloadingPdf(true);
    try {
      await downloadGuestTicketPdfForOrder(successTicket.orderId, successTicket.email);
    } catch (err) {
      showFailure(err, 'ticket-pdf');
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (!listing?.checkoutTier) {
    return (
      <div className={embed ? 'min-h-0 bg-background p-4' : 'min-h-screen bg-background p-6'}>
        <div className="mx-auto max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">Lien d’inscription invalide</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Utilisez un lien Pass Festival ou Nexus Night fourni par l’organisation.
          </p>
          {!embed && (
            <Button className="mt-4" variant="secondary" asChild>
              <Link to="/">Retour à la billetterie</Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={
        embed
          ? 'min-h-0 bg-background text-foreground'
          : 'min-h-screen bg-background text-foreground'
      }
    >
      {!embed && (
        <header className="border-b border-border/40 bg-background/90 px-4 py-3">
          <div className="container flex items-center gap-3">
            <StorefrontBrandHomeLink />
            <div>
              <p className="text-sm font-semibold">{listing.title}</p>
              <p className="text-xs text-muted-foreground">Inscription officielle TDEV Festival</p>
            </div>
          </div>
        </header>
      )}

      <main className={embed ? 'p-3 sm:p-4' : 'container max-w-2xl py-8 px-4'}>
        {embed && (
          <div className="mb-3">
            <StorefrontBrandHomeLink embed imageClassName="h-7" />
          </div>
        )}
        <div className="mb-4">
          <h1 className="text-xl font-display font-bold tracking-tight">{listing.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {listing.isFree
              ? 'Formulaire gratuit · billet par e-mail après confirmation'
              : 'Formulaire puis paiement · billet par e-mail après paiement confirmé'}
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm sm:p-6">
          <RegistrationWizard
            key={wizardKey}
            passTitle={listing.title}
            isFree={listing.isFree}
            amountMinor={PASS_TIER_PRICE_MINOR[listing.checkoutTier]}
            submitting={submitting}
            onSubmit={(values, manualPayment) => void handleSubmit(values, listing, manualPayment)}
          />
        </div>
      </main>

      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{successTitle}</DialogTitle>
            <DialogDescription className="text-base leading-relaxed pt-2">{successBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setSuccessOpen(false);
                notifyEmbedParent('tdev-inscription-close', {}, parentOrigin);
                if (embed) navigate(0);
              }}
            >
              Fermer
            </Button>
            {successTicket ? (
              <Button
                className="w-full sm:w-auto"
                disabled={downloadingPdf}
                onClick={() => void handleDownloadTicket()}
              >
                {downloadingPdf ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Téléchargement…
                  </>
                ) : listing.checkoutTier === 'vip' ? (
                  'Télécharger mes billets'
                ) : (
                  'Télécharger mon billet'
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={failureOpen} onOpenChange={setFailureOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{failureTitle}</DialogTitle>
            <DialogDescription className="text-base leading-relaxed pt-2">{failureBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button className="w-full" variant="secondary" onClick={() => setFailureOpen(false)}>
              Fermer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
