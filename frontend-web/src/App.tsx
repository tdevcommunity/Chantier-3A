import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, Calendar, MapPin, Check, Gift } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { RegistrationWizard } from '@/components/registration/RegistrationWizard';
import { resolveLiveCheckoutProduct } from '@/lib/billetterie-storefront';
import { completeCheckout } from '@/lib/billetterie-checkout';
import {
    clearRegistrationDraft,
    loadRegistrationDraft,
    type RegistrationFormValues,
} from '@/lib/registration-form';
import {
    billetterieCardClass,
    billetterieCtaClass,
    billetterieCtaVariant,
    billetteriePriceClass,
    getStaticBilletterieListing,
    STATIC_FESTIVAL_TITLE,
    STATIC_VENUE_LABEL,
    type BilletterieListingProduct,
} from '@/lib/static-billetterie-catalog';
import { checkoutFailureCopy, logCheckoutDiagnostic } from '@/lib/user-facing-checkout-error';
import { StorefrontBrandHomeLink } from '@/components/storefront/StorefrontBrandHomeLink';
import { TDEV_LOGO_URL } from '@/components/brand/tdev-brand-assets';
import { downloadGuestTicketPdfForOrder } from '@/lib/download-guest-ticket-pdf';
import { isVeltoReturn, settleVeltoReturnFromUrl } from '@/lib/velto-payment-return';

const isSafeRedirect = (url: string) => {
    try {
        return new URL(url).protocol === 'https:';
    } catch {
        return false;
    }
};

export default function App() {
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const products = useMemo(() => getStaticBilletterieListing(), []);
    const [registerOpen, setRegisterOpen] = useState(false);
    const [activeListing, setActiveListing] = useState<BilletterieListingProduct | null>(null);
    /** Remonte le wizard à chaque ouverture pour repartir du brouillon de session. */
    const [wizardKey, setWizardKey] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [confirmingPayment, setConfirmingPayment] = useState(() => isVeltoReturn(searchParams));
    const veltoReturnHandled = useRef(false);

    const [successOpen, setSuccessOpen] = useState(false);
    const [successTitle, setSuccessTitle] = useState('');
    const [successBody, setSuccessBody] = useState('');
    const [successTicket, setSuccessTicket] = useState<{ orderId: string; email: string } | null>(null);
    const [downloadingPdf, setDownloadingPdf] = useState(false);

    const [failureOpen, setFailureOpen] = useState(false);
    const [failureTitle, setFailureTitle] = useState('');
    const [failureBody, setFailureBody] = useState('');

    const openExternal = (url: string) => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const beginCheckout = (listing: BilletterieListingProduct) => {
        if (listing.externalUrl) {
            openExternal(listing.externalUrl);
            return;
        }
        if (!listing.checkoutTier) return;

        setActiveListing(listing);
        setWizardKey((prev) => prev + 1);
        setRegisterOpen(true);
    };

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
    };

    const closeSuccess = () => {
        setSuccessOpen(false);
        setSuccessTicket(null);
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

    const showFailure = (err: unknown, context = 'checkout') => {
        logCheckoutDiagnostic(context, err);
        const copy = checkoutFailureCopy(err);
        setFailureTitle(copy.title);
        setFailureBody(copy.body);
        setFailureOpen(true);
    };

    useEffect(() => {
        if (veltoReturnHandled.current || !isVeltoReturn(searchParams)) return;
        veltoReturnHandled.current = true;
        setConfirmingPayment(true);
        setRegisterOpen(true);
        const draftEmail = loadRegistrationDraft()?.values.email.trim() || '';
        void settleVeltoReturnFromUrl(searchParams, navigate, location.pathname, draftEmail)
            .then((result) => {
            if (!result) return;
            const email = result.buyerEmail.trim() || draftEmail;
            const ticket =
                result.outcome === 'paid' && email ? { orderId: result.orderId, email } : null;
            if (result.outcome === 'paid') {
                showSuccess(
                    'Paiement confirmé',
                    'Merci ! Votre billet est réservé. Vous recevrez votre confirmation par e-mail dans quelques instants. Pensez à vérifier vos spams.',
                    ticket,
                );
            } else if (result.outcome === 'failed' || result.outcome === 'unpaid') {
                showFailure(new Error('velto_declined'), 'velto_return');
            } else {
                showSuccess(
                    'Paiement en cours de validation',
                    'Nous vérifions votre paiement Mobile Money. Aucun billet n’est émis tant que la banque n’a pas confirmé.',
                );
            }
        })
            .finally(() => setConfirmingPayment(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois par retour Velto
    }, []);

    const handleSubmit = async (values: RegistrationFormValues) => {
        if (!activeListing?.checkoutTier) return;

        const passTitle = activeListing.title;
        setSubmitting(true);
        try {
            const live = await resolveLiveCheckoutProduct(activeListing.checkoutTier);
            const outcome = await completeCheckout({
                eventId: live.event.id,
                ticketType: live.product.ticketType,
                registration: values,
                onPaymentStart: () => setRegisterOpen(false),
            });
            setRegisterOpen(false);

            if (outcome.kind === 'free_confirmed') {
                showSuccess(
                    'Inscription réussie',
                    `Merci ! Votre inscription au ${passTitle} est confirmée. Vous recevrez votre billet par e-mail à ${outcome.email} dans quelques instants. Pensez à vérifier vos spams.`,
                    { orderId: outcome.orderId, email: outcome.email },
                );
                return;
            }

            if (outcome.kind === 'paid') {
                showSuccess(
                    'Paiement confirmé',
                    `Merci ! Votre paiement pour le ${passTitle} est confirmé. Vous recevrez votre billet par e-mail à ${outcome.email} dans quelques instants. Pensez à vérifier vos spams.`,
                    { orderId: outcome.orderId, email: outcome.email },
                );
                return;
            }

            if (outcome.redirectUrl && isSafeRedirect(outcome.redirectUrl)) {
                window.location.href = outcome.redirectUrl;
                return;
            }

            showSuccess(
                'Paiement en attente',
                `Finalisez votre paiement pour le ${passTitle}. Votre billet sera envoyé à ${outcome.email} uniquement après confirmation du paiement.`,
            );
        } catch (err) {
            showFailure(err);
        } finally {
            setSubmitting(false);
        }
    };

    const venue = STATIC_VENUE_LABEL;
    const heroTitle = STATIC_FESTIVAL_TITLE;
    return (
        <div className="min-h-screen bg-background text-foreground transition-colors duration-300">
            <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/60 shadow-soft">
                <div className="container flex min-h-14 items-center justify-between gap-2 py-2 sm:h-16 sm:gap-3 sm:py-0">
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                        <StorefrontBrandHomeLink />
                        <div className="hidden min-w-0 flex-col sm:flex">
                            <span className="truncate font-display text-lg font-extrabold tracking-tight text-foreground">
                                TDEV Festival
                            </span>
                            <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Billetterie officielle
                            </span>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1 sm:gap-3">
                        <Button size="sm" className="h-9 shrink-0 px-2.5 text-xs shadow-glow-primary sm:h-9 sm:px-3 sm:text-sm" asChild>
                            <a href="#passes">
                                <span className="sm:hidden">Réserver</span>
                                <span className="hidden sm:inline">Réserver un billet</span>
                            </a>
                        </Button>
                    </div>
                </div>
            </header>

            <section className="relative overflow-hidden py-16 md:py-24 bg-gradient-to-b from-primary/5 via-transparent to-transparent">
                <div className="container relative z-10 text-center flex flex-col items-center">
                    <h1 className="text-4xl md:text-display-xl font-display font-black tracking-tight text-foreground max-w-4xl leading-tight">
                        Réservez vos tickets pour le{' '}
                        <span className="text-primary">{heroTitle}</span>
                    </h1>
                    <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-2xl leading-relaxed">
                        Accédez aux conférences, aux ateliers, à la soirée Nexus Night et repartez avec le Welcome Pack
                        officiel.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-6 text-sm text-muted-foreground justify-center">
                        <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-primary" />
                            <span>Festival sur 2 jours</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-primary" />
                            <span>{venue}</span>
                        </div>
                    </div>
                </div>
            </section>

            <main id="passes" className="container py-10 pb-20">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
                    {products.map((ticket, index) => (
                        <motion.div
                            key={ticket.listingId}
                            initial={{ opacity: 0, y: 25 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.45, delay: index * 0.12 }}
                            className="flex"
                        >
                            <Card className={billetterieCardClass(ticket)}>
                                {ticket.badgeText && (
                                    <div className="absolute top-4 right-4 z-10">
                                        <Badge
                                            variant={ticket.popular ? 'default' : 'secondary'}
                                            className="font-semibold text-xs shadow-sm"
                                        >
                                            {ticket.badgeText}
                                        </Badge>
                                    </div>
                                )}

                                <div className="relative h-44 overflow-hidden bg-muted/50">
                                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/50 to-transparent" />
                                    <div className="absolute bottom-4 left-6 right-6">
                                        <span className="text-xs uppercase tracking-wider text-primary font-bold">
                                            {ticket.category}
                                        </span>
                                        <h3 className="font-display font-extrabold text-2xl text-foreground mt-0.5 leading-snug">
                                            {ticket.title}
                                        </h3>
                                        {ticket.subtitle && (
                                            <p className="text-sm text-muted-foreground mt-0.5">{ticket.subtitle}</p>
                                        )}
                                    </div>
                                </div>

                                <CardHeader className="pt-2 pb-4">
                                    <div className="flex items-baseline gap-2 mb-2">
                                        <span
                                            className={`font-display font-black text-3xl tracking-tight ${billetteriePriceClass(ticket)}`}
                                        >
                                            {ticket.priceLabel}
                                        </span>
                                    </div>
                                    <CardDescription className="text-sm leading-relaxed text-muted-foreground">
                                        {ticket.description}
                                    </CardDescription>
                                </CardHeader>

                                <CardContent className="mt-auto pt-2 pb-6 flex-grow">
                                    <div className="border-t border-border/40 pt-4">
                                        <p className="text-xs font-bold uppercase tracking-wider text-foreground/80 mb-3 flex items-center gap-1.5">
                                            <Gift className="h-3.5 w-3.5 text-primary" /> Ce qui est inclus :
                                        </p>
                                        <ul className="space-y-2.5 text-sm">
                                            {ticket.inclusions.map((item) => (
                                                <li key={item} className="flex items-start gap-2.5">
                                                    <div className="mt-0.5 p-0.5 rounded-full bg-primary/10 text-primary shrink-0">
                                                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                                                    </div>
                                                    <span className="text-foreground/90 font-medium leading-tight">
                                                        {item}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </CardContent>

                                <CardFooter className="pt-4 pb-6 border-t border-border/40 bg-muted/20">
                                    {ticket.externalUrl ? (
                                        <Button
                                            variant="outline"
                                            className="w-full font-bold h-11"
                                            onClick={() => beginCheckout(ticket)}
                                        >
                                            Découvrir les goodies
                                        </Button>
                                    ) : (
                                        <Button
                                            variant={billetterieCtaVariant(ticket)}
                                            className={billetterieCtaClass(ticket)}
                                            onClick={() => beginCheckout(ticket)}
                                        >
                                            {ticket.isFree ? 'Réserver gratuitement' : 'Choisir ce pass'}
                                        </Button>
                                    )}
                                </CardFooter>
                            </Card>
                        </motion.div>
                    ))}
                </div>
            </main>

            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
                <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{activeListing?.title ?? 'Inscription'}</DialogTitle>
                        <DialogDescription>
                            {activeListing?.isFree
                                ? 'Complétez le formulaire pour recevoir votre pass par e-mail.'
                                : 'Complétez le formulaire, puis réglez votre pass. Vous recevrez le Pass Nexus Night et le Pass Festival par e-mail.'}
                        </DialogDescription>
                    </DialogHeader>
                    <RegistrationWizard
                        key={wizardKey}
                        passTitle={activeListing?.title ?? 'pass'}
                        isFree={activeListing?.isFree ?? true}
                        submitting={submitting || confirmingPayment}
                        submittingLabel={
                            confirmingPayment
                                ? 'Confirmation du paiement et émission du billet…'
                                : undefined
                        }
                        resumeAtSummaryStep={confirmingPayment}
                        onSubmit={(values) => void handleSubmit(values)}
                    />
                </DialogContent>
            </Dialog>

            <Dialog open={successOpen} onOpenChange={(open) => (open ? setSuccessOpen(true) : closeSuccess())}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{successTitle}</DialogTitle>
                        <DialogDescription className="text-base leading-relaxed pt-2">{successBody}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" className="w-full sm:w-auto" onClick={closeSuccess}>
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
                                ) : (
                                    activeListing?.checkoutTier === 'vip'
                                        ? 'Télécharger mes billets'
                                        : 'Télécharger mon billet'
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

            <footer className="border-t border-border/40 py-8 bg-muted/30 text-center text-sm text-muted-foreground">
                <div className="container flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <img src={TDEV_LOGO_URL} className="h-6 w-auto" alt="T-Dev Logo" />
                        <span>© 2026 TDEV Festival. Tous droits réservés.</span>
                    </div>
                </div>
            </footer>
        </div>
    );
}
