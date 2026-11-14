import { useEffect, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { payments as paymentsApi } from '@/lib/api';
import type { ManualOperatorOption, ManualPaymentOptions } from '@/lib/api-types';
import { DEFAULT_FESTIVAL_CURRENCY } from '@/lib/festival-storefront';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface ManualPaymentValue {
    operator: string;
    reference: string;
    phone: string;
}

export type ManualPaymentErrors = Partial<Record<keyof ManualPaymentValue, string>>;

export const EMPTY_MANUAL_PAYMENT: ManualPaymentValue = { operator: '', reference: '', phone: '' };

/** Garde lettres, chiffres et tirets ; majuscules (même règle que le serveur). */
export function formatPaymentReference(raw: string): string {
    return raw.replace(/[^a-zA-Z0-9-]/g, '').toUpperCase().slice(0, 40);
}

export function validateManualPayment(value: ManualPaymentValue, minReferenceLength: number): ManualPaymentErrors {
    const errors: ManualPaymentErrors = {};
    if (!value.operator) errors.operator = 'Choisissez l’opérateur utilisé pour le paiement.';
    if (formatPaymentReference(value.reference).length < minReferenceLength) {
        errors.reference = `Référence trop courte (minimum ${minReferenceLength} caractères).`;
    }
    if (value.phone.replace(/\D/g, '').length < 8) {
        errors.phone = 'Numéro invalide (8 chiffres minimum).';
    }
    return errors;
}

interface ManualPaymentStepProps {
    amountMinor: number;
    passTitle: string;
    value: ManualPaymentValue;
    errors: ManualPaymentErrors;
    onChange: (next: ManualPaymentValue) => void;
    /** Remonte le nombre minimal de caractères de la référence une fois les options chargées. */
    onOptionsLoaded?: (options: ManualPaymentOptions) => void;
}

export function ManualPaymentStep({
    amountMinor,
    passTitle,
    value,
    errors,
    onChange,
    onOptionsLoaded,
}: ManualPaymentStepProps) {
    const [options, setOptions] = useState<ManualPaymentOptions | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoadError(false);
        paymentsApi
            .manualOptions(amountMinor)
            .then((res) => {
                if (cancelled) return;
                setOptions(res);
                onOptionsLoaded?.(res);
            })
            .catch(() => {
                if (!cancelled) setLoadError(true);
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- chargé une fois par montant
    }, [amountMinor]);

    const selected: ManualOperatorOption | undefined = options?.operators.find((o) => o.code === value.operator);
    const money = (minor: number) => formatMoney(minor, DEFAULT_FESTIVAL_CURRENCY);

    const copyNumber = async (number: string) => {
        try {
            await navigator.clipboard.writeText(number);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
        } catch {
            /* presse-papiers indisponible : le numéro reste affiché */
        }
    };

    if (loadError) {
        return (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                Impossible de charger les moyens de paiement. Vérifiez votre connexion et réessayez.
            </p>
        );
    }

    if (!options) {
        return (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement des moyens de paiement…
            </p>
        );
    }

    return (
        <div className="space-y-5">
            <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">Paiement de votre {passTitle}</p>
                <p className="text-sm text-muted-foreground">
                    Choisissez un opérateur, envoyez le montant au numéro marchand affiché, puis saisissez la
                    référence de la transaction reçue par SMS.
                </p>
            </div>

            <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium">Opérateur utilisé</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {options.operators.map((op) => {
                        const active = op.code === value.operator;
                        return (
                            <button
                                key={op.code}
                                type="button"
                                onClick={() => onChange({ ...value, operator: op.code })}
                                aria-pressed={active}
                                className={cn(
                                    'rounded-lg border p-3 text-left text-sm transition-colors',
                                    active
                                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                                        : 'border-border/60 hover:border-primary/50',
                                )}
                            >
                                <span className="block font-semibold">{op.label}</span>
                                <span className="block text-xs text-muted-foreground">
                                    {op.fee_minor > 0 ? `+ ${money(op.fee_minor)} de frais de retrait` : 'Sans frais'}
                                </span>
                            </button>
                        );
                    })}
                </div>
                {errors.operator && <p className="text-xs text-destructive">{errors.operator}</p>}
            </fieldset>

            {selected && (
                <>
                    <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Numéro marchand {selected.label}
                        </p>
                        <div className="flex items-center justify-between gap-3">
                            <span className="font-mono text-xl font-bold tracking-wider">
                                {selected.merchant_number}
                            </span>
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void copyNumber(selected.merchant_number)}
                            >
                                {copied ? (
                                    <>
                                        <Check className="mr-1.5 h-4 w-4" /> Copié
                                    </>
                                ) : (
                                    <>
                                        <Copy className="mr-1.5 h-4 w-4" /> Copier
                                    </>
                                )}
                            </Button>
                        </div>
                        <dl className="space-y-1 border-t border-border/60 pt-3 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">{passTitle}</dt>
                                <dd>{money(options.amount_minor)}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Frais de retrait {selected.label}</dt>
                                <dd>{selected.fee_minor > 0 ? money(selected.fee_minor) : 'Aucun'}</dd>
                            </div>
                            <div className="flex justify-between pt-1 text-base font-bold">
                                <dt>Montant exact à envoyer</dt>
                                <dd>{money(selected.total_minor)}</dd>
                            </div>
                        </dl>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-1.5">
                            <Label htmlFor="manual_phone">Numéro depuis lequel vous avez payé</Label>
                            <Input
                                id="manual_phone"
                                type="tel"
                                inputMode="tel"
                                autoComplete="tel"
                                placeholder="Ex : 90 00 00 00"
                                value={value.phone}
                                onChange={(ev) => onChange({ ...value, phone: ev.target.value })}
                            />
                            {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="manual_reference">Référence du paiement</Label>
                            <Input
                                id="manual_reference"
                                autoComplete="off"
                                placeholder="Ex : MP240101ABC123"
                                value={value.reference}
                                onChange={(ev) =>
                                    onChange({ ...value, reference: formatPaymentReference(ev.target.value) })
                                }
                            />
                            <p className="text-xs text-muted-foreground">
                                Référence (ID de transaction) figurant sur le SMS de confirmation de votre opérateur.
                            </p>
                            {errors.reference && <p className="text-xs text-destructive">{errors.reference}</p>}
                        </div>
                    </div>

                    <p className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                        Votre inscription sera <strong>en attente de vérification</strong>. Notre équipe contrôle
                        votre paiement ; votre confirmation et votre billet vous seront envoyés par e-mail
                        uniquement après validation.
                    </p>
                </>
            )}
        </div>
    );
}
