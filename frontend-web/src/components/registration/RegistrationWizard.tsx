import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
    AGE_RANGE_OPTIONS,
    COUNTRY_OPTIONS,
    DIGITAL_LEVEL_OPTIONS,
    DISCOVERY_CHANNEL_OPTIONS,
    GENDER_OPTIONS,
    PARTICIPATION_REASON_OPTIONS,
    PREFERRED_CHANNEL_OPTIONS,
    PRIOR_PARTICIPATION_OPTIONS,
    REGISTRATION_STEP_COUNT,
    REGISTRATION_STEP_TITLES,
    SITUATION_OPTIONS,
    TOPIC_OPTIONS,
    emptyRegistrationForm,
    firstInvalidRegistrationStep,
    labelForChoice,
    labelsForChoices,
    loadRegistrationDraft,
    saveRegistrationDraft,
    validateRegistrationStep,
    type ChoiceOption,
    type RegistrationFieldErrors,
    type RegistrationFieldName,
    type RegistrationFormValues,
} from '@/lib/registration-form';

interface RegistrationWizardProps {
    /** Titre du pass sélectionné, affiché en en-tête. */
    passTitle: string;
    /** Le pass gratuit et le pass payant partagent exactement le même formulaire. */
    isFree: boolean;
    submitting: boolean;
    /** Libellé du bouton principal pendant `submitting` (ex. retour Mobile Money). */
    submittingLabel?: string;
    /** Afficher l’étape récapitulatif (retour paiement Velto). */
    resumeAtSummaryStep?: boolean;
    onSubmit: (values: RegistrationFormValues) => void;
}

export function RegistrationWizard({
    passTitle,
    isFree,
    submitting,
    submittingLabel,
    resumeAtSummaryStep = false,
    onSubmit,
}: RegistrationWizardProps) {
    const draft = useMemo(() => loadRegistrationDraft(), []);
    const [values, setValues] = useState<RegistrationFormValues>(draft?.values ?? emptyRegistrationForm());
    const [step, setStep] = useState(() => {
        if (resumeAtSummaryStep) return REGISTRATION_STEP_COUNT - 1;
        const saved = draft?.step ?? 0;
        return Math.min(Math.max(saved, 0), REGISTRATION_STEP_COUNT - 1);
    });
    const [errors, setErrors] = useState<RegistrationFieldErrors>({});

    useEffect(() => {
        saveRegistrationDraft(values, step);
    }, [values, step]);

    const set = <K extends RegistrationFieldName>(key: K, value: RegistrationFormValues[K]) => {
        setValues((prev) => ({ ...prev, [key]: value }));
        setErrors((prev) => {
            if (!(key in prev)) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    const toggleInList = (key: 'participation_reasons' | 'topics', value: string) => {
        const current = values[key];
        set(key, current.includes(value) ? current.filter((v) => v !== value) : [...current, value]);
    };

    const goNext = () => {
        const stepErrors = validateRegistrationStep(step, values);
        setErrors(stepErrors);
        if (Object.keys(stepErrors).length > 0) return;
        setStep((prev) => Math.min(prev + 1, REGISTRATION_STEP_COUNT - 1));
    };

    const goBack = () => {
        setErrors({});
        setStep((prev) => Math.max(prev - 1, 0));
    };

    const handleFinish = () => {
        const invalidStep = firstInvalidRegistrationStep(values);
        if (invalidStep >= 0) {
            setStep(invalidStep);
            setErrors(validateRegistrationStep(invalidStep, values));
            return;
        }
        // Le brouillon n'est effacé qu'en cas de succès (voir App.tsx) pour ne rien perdre si le paiement échoue.
        onSubmit(values);
    };

    const isLastStep = step === REGISTRATION_STEP_COUNT - 1;
    const progress = Math.round(((step + 1) / REGISTRATION_STEP_COUNT) * 100);

    return (
        <div className="space-y-5">
            <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">{REGISTRATION_STEP_TITLES[step]}</p>
                    <p className="text-xs text-muted-foreground">
                        Étape {step + 1} sur {REGISTRATION_STEP_COUNT}
                    </p>
                </div>
                <Progress value={progress} className="h-1.5" />
            </div>

            <form
                className="space-y-5"
                onSubmit={(ev) => {
                    ev.preventDefault();
                    if (isLastStep) handleFinish();
                    else goNext();
                }}
            >
                {step === 0 && (
                    <>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label="Nom" htmlFor="last_name" error={errors.last_name} required>
                                <Input
                                    id="last_name"
                                    value={values.last_name}
                                    onChange={(ev) => set('last_name', ev.target.value)}
                                    autoComplete="family-name"
                                />
                            </Field>
                            <Field label="Prénom" htmlFor="first_name" error={errors.first_name} required>
                                <Input
                                    id="first_name"
                                    value={values.first_name}
                                    onChange={(ev) => set('first_name', ev.target.value)}
                                    autoComplete="given-name"
                                />
                            </Field>
                        </div>
                        <ChoiceField
                            label="Tranche d'âge"
                            options={AGE_RANGE_OPTIONS}
                            value={values.age_range}
                            onChange={(value) => set('age_range', value)}
                            error={errors.age_range}
                            required
                        />
                        <ChoiceField
                            label="Genre"
                            options={GENDER_OPTIONS}
                            value={values.gender}
                            onChange={(value) => set('gender', value)}
                            hint="Facultatif"
                        />
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <SelectField
                                id="country"
                                label="Pays de résidence"
                                placeholder="Choisir votre pays"
                                options={COUNTRY_OPTIONS}
                                value={values.country}
                                onChange={(value) => set('country', value)}
                                error={errors.country}
                                required
                                groupedCountries
                            />
                            <Field label="Ville de résidence" htmlFor="city" error={errors.city} required>
                                <Input
                                    id="city"
                                    value={values.city}
                                    onChange={(ev) => set('city', ev.target.value)}
                                    autoComplete="address-level2"
                                />
                            </Field>
                        </div>
                    </>
                )}

                {step === 1 && (
                    <>
                        <Field
                            label="Numéro de téléphone ou WhatsApp"
                            htmlFor="phone"
                            error={errors.phone}
                            hint="Pour vous contacter si besoin (informations pratiques du festival)."
                            required
                        >
                            <Input
                                id="phone"
                                type="tel"
                                inputMode="tel"
                                placeholder={
                                    values.country === 'Togo' ? '+228 90 00 00 00' : '+228… ou +229…'
                                }
                                value={values.phone}
                                onChange={(ev) => set('phone', ev.target.value)}
                                autoComplete="tel"
                            />
                        </Field>
                        <Field
                            label="Adresse e-mail"
                            htmlFor="email"
                            error={errors.email}
                            hint="Votre billet sera envoyé à cette adresse."
                            required
                        >
                            <Input
                                id="email"
                                type="email"
                                value={values.email}
                                onChange={(ev) => set('email', ev.target.value)}
                                autoComplete="email"
                            />
                        </Field>
                    </>
                )}

                {step === 2 && (
                    <>
                        <SelectField
                            id="situation"
                            label="Situation actuelle"
                            placeholder="Choisir votre situation"
                            options={SITUATION_OPTIONS}
                            value={values.situation}
                            onChange={(value) => set('situation', value)}
                            error={errors.situation}
                            required
                        />
                        <Field
                            label="Domaine d'activité ou d'étude"
                            htmlFor="activity_domain"
                            error={errors.activity_domain}
                            required
                        >
                            <Input
                                id="activity_domain"
                                value={values.activity_domain}
                                onChange={(ev) => set('activity_domain', ev.target.value)}
                                placeholder="Génie logiciel, marketing digital, finance…"
                            />
                        </Field>
                        <Field
                            label="Établissement ou entreprise"
                            htmlFor="school_program"
                            hint="Facultatif"
                        >
                            <Input
                                id="school_program"
                                value={values.school_program}
                                onChange={(ev) => set('school_program', ev.target.value)}
                            />
                        </Field>
                        <ChoiceField
                            label="Votre niveau par rapport au numérique"
                            options={DIGITAL_LEVEL_OPTIONS}
                            value={values.digital_level}
                            onChange={(value) => set('digital_level', value)}
                            error={errors.digital_level}
                            required
                        />
                    </>
                )}

                {step === 3 && (
                    <>
                        <MultiChoiceField
                            label="Pourquoi souhaitez-vous participer ?"
                            hint="Plusieurs réponses possibles"
                            options={PARTICIPATION_REASON_OPTIONS}
                            selected={values.participation_reasons}
                            onToggle={(value) => toggleInList('participation_reasons', value)}
                            error={errors.participation_reasons}
                        />
                        <MultiChoiceField
                            label="Quels sujets vous intéressent le plus ?"
                            hint="Plusieurs réponses possibles"
                            options={TOPIC_OPTIONS}
                            selected={values.topics}
                            onToggle={(value) => toggleInList('topics', value)}
                            error={errors.topics}
                        />
                        <Field
                            label="Qu'attendez-vous de cette édition ?"
                            htmlFor="expectations"
                            error={errors.expectations}
                            required
                        >
                            <Textarea
                                id="expectations"
                                rows={4}
                                value={values.expectations}
                                onChange={(ev) => set('expectations', ev.target.value)}
                            />
                        </Field>
                    </>
                )}

                {step === 4 && (
                    <>
                        <ChoiceField
                            label="Avez-vous déjà participé au TDEV Festival ?"
                            options={PRIOR_PARTICIPATION_OPTIONS}
                            value={values.prior_participation}
                            onChange={(value) => set('prior_participation', value)}
                            error={errors.prior_participation}
                            required
                        />
                        {values.prior_participation.startsWith('yes') && (
                            <Field
                                label="Qu'avez-vous le plus apprécié ?"
                                htmlFor="prior_liked"
                                hint="Facultatif"
                            >
                                <Textarea
                                    id="prior_liked"
                                    rows={3}
                                    value={values.prior_liked}
                                    onChange={(ev) => set('prior_liked', ev.target.value)}
                                />
                            </Field>
                        )}
                        <Field
                            label="Quels profils aimeriez-vous rencontrer sur place ?"
                            htmlFor="want_to_meet"
                            hint="Facultatif"
                        >
                            <Textarea
                                id="want_to_meet"
                                rows={3}
                                value={values.want_to_meet}
                                onChange={(ev) => set('want_to_meet', ev.target.value)}
                                placeholder="Recruteurs, mentors, porteurs de projets…"
                            />
                        </Field>
                    </>
                )}

                {step === 5 && (
                    <>
                        <SelectField
                            id="discovery_channel"
                            label="Comment avez-vous connu le TDEV Festival ?"
                            placeholder="Choisir une réponse"
                            options={DISCOVERY_CHANNEL_OPTIONS}
                            value={values.discovery_channel}
                            onChange={(value) => set('discovery_channel', value)}
                            error={errors.discovery_channel}
                            required
                        />
                        <Field
                            label="Qui vous a recommandé le festival ?"
                            htmlFor="referred_by"
                            hint="Facultatif"
                        >
                            <Input
                                id="referred_by"
                                value={values.referred_by}
                                onChange={(ev) => set('referred_by', ev.target.value)}
                                placeholder="Nom d'une personne, école, communauté ou entreprise"
                            />
                        </Field>
                    </>
                )}

                {step === 6 && (
                    <>
                        <ChoiceField
                            label="Souhaitez-vous être informé(e) des prochaines actualités ?"
                            options={[
                                { value: 'yes', label: 'Oui' },
                                { value: 'no', label: 'Non' },
                            ]}
                            value={values.stay_informed}
                            onChange={(value) => set('stay_informed', value)}
                            error={errors.stay_informed}
                            required
                        />
                        {values.stay_informed === 'yes' && (
                            <ChoiceField
                                label="Canal de communication préféré"
                                options={PREFERRED_CHANNEL_OPTIONS}
                                value={values.preferred_channel}
                                onChange={(value) => set('preferred_channel', value)}
                                error={errors.preferred_channel}
                                required
                            />
                        )}
                        <label className="flex items-start gap-3 rounded-lg border border-border/60 p-3 text-sm">
                            <Checkbox
                                checked={values.consent_marketing}
                                onCheckedChange={(checked) => set('consent_marketing', checked === true)}
                                className="mt-0.5"
                            />
                            <span className="leading-relaxed text-muted-foreground">
                                J&apos;accepte de recevoir les communications des partenaires du festival.
                            </span>
                        </label>
                    </>
                )}

                {step === 7 && (
                    <>
                        <SummaryList values={values} />
                        <label className="flex items-start gap-3 rounded-lg border border-border/60 p-3 text-sm">
                            <Checkbox
                                checked={values.consent_data_processing}
                                onCheckedChange={(checked) => set('consent_data_processing', checked === true)}
                                className="mt-0.5"
                            />
                            <span className="leading-relaxed text-muted-foreground">
                                J&apos;accepte que mes informations soient utilisées pour l&apos;organisation du
                                TDEV Festival 2026.
                            </span>
                        </label>
                        {errors.consent_data_processing && (
                            <p className="text-xs text-destructive">{errors.consent_data_processing}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                            {isFree
                                ? `Après confirmation, votre ${passTitle} vous sera envoyé par e-mail (gratuit, sans paiement).`
                                : `Étape suivante : règlement sécurisé de votre ${passTitle}. Votre billet vous sera envoyé par e-mail une fois le paiement confirmé.`}
                        </p>
                    </>
                )}

                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-between">
                    <Button
                        type="button"
                        variant="outline"
                        className="sm:w-auto"
                        onClick={goBack}
                        disabled={step === 0 || submitting}
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Retour
                    </Button>
                    <Button type="submit" className="sm:w-auto" disabled={submitting}>
                        {submitting ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {submittingLabel ?? 'Envoi en cours…'}
                            </>
                        ) : isLastStep ? (
                            isFree ? (
                                "Valider l'inscription"
                            ) : (
                                'Continuer vers le paiement'
                            )
                        ) : (
                            <>
                                Suivant
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </>
                        )}
                    </Button>
                </div>
            </form>
        </div>
    );
}

const CHOICE_CARD_BASE =
    'flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-sm leading-snug transition-all duration-200 shadow-sm';
const CHOICE_CARD_SELECTED = 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-md';
const CHOICE_CARD_IDLE = 'border-border/70 bg-card/40 hover:border-primary/35 hover:bg-muted/30';

/** Pays affichés par région dans le menu déroulant. */
const COUNTRY_GROUP_WEST = new Set([
    'Togo',
    'Bénin',
    'Burkina Faso',
    "Côte d'Ivoire",
    'Ghana',
    'Niger',
    'Nigeria',
    'Sénégal',
    'Mali',
    'Cameroun',
    'Gabon',
    'Congo',
    'République démocratique du Congo',
]);
const COUNTRY_GROUP_NORTH = new Set(['Maroc', 'Tunisie']);
function SelectField(props: {
    id: string;
    label: string;
    placeholder: string;
    options: ChoiceOption[];
    value: string;
    onChange: (value: string) => void;
    error?: string | undefined;
    hint?: string;
    required?: boolean;
    groupedCountries?: boolean;
}) {
    const hasValue = Boolean(props.value);
    return (
        <div className="space-y-2">
            <Label htmlFor={props.id}>
                {props.label}
                {props.required && <span className="ml-1 text-destructive">*</span>}
            </Label>
            <Select value={hasValue ? props.value : undefined} onValueChange={props.onChange}>
                <SelectTrigger
                    id={props.id}
                    aria-invalid={Boolean(props.error)}
                    className={cn(
                        'h-11 bg-background text-base sm:h-9 sm:text-sm',
                        props.error && 'border-destructive focus:ring-destructive',
                        !hasValue && 'text-muted-foreground',
                    )}
                >
                    <SelectValue placeholder={props.placeholder} />
                </SelectTrigger>
                <SelectContent
                    position="popper"
                    sideOffset={6}
                    className="max-h-[min(18rem,55vh)] w-[var(--radix-select-trigger-width)] rounded-xl border-border/80 p-1 shadow-lg"
                >
                    {props.groupedCountries ? (
                        <>
                            <CountrySelectGroup
                                label="Afrique de l'Ouest et centrale"
                                options={props.options.filter((o) => COUNTRY_GROUP_WEST.has(o.value))}
                            />
                            <CountrySelectGroup
                                label="Afrique du Nord"
                                options={props.options.filter((o) => COUNTRY_GROUP_NORTH.has(o.value))}
                            />
                            <CountrySelectGroup
                                label="Europe et Amérique"
                                options={props.options.filter((o) =>
                                    ['France', 'Canada', 'Belgique'].includes(o.value),
                                )}
                            />
                            <CountrySelectGroup
                                label="Autre"
                                options={props.options.filter((o) => o.value === 'Autre pays')}
                            />
                        </>
                    ) : (
                        props.options.map((option) => (
                            <SelectItem
                                key={option.value}
                                value={option.value}
                                className="rounded-lg py-2.5 pl-3 pr-9 text-sm focus:bg-primary/10 focus:text-foreground"
                            >
                                {option.label}
                            </SelectItem>
                        ))
                    )}
                </SelectContent>
            </Select>
            {props.hint && !props.error && <p className="text-xs text-muted-foreground">{props.hint}</p>}
            {props.error && <p className="text-xs text-destructive">{props.error}</p>}
        </div>
    );
}

function CountrySelectGroup(props: { label: string; options: ChoiceOption[] }) {
    if (props.options.length === 0) return null;
    return (
        <SelectGroup>
            <SelectLabel className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {props.label}
            </SelectLabel>
            {props.options.map((option) => (
                <SelectItem
                    key={option.value}
                    value={option.value}
                    className="rounded-lg py-2.5 pl-3 pr-9 text-sm focus:bg-primary/10 focus:text-foreground"
                >
                    {option.label}
                </SelectItem>
            ))}
        </SelectGroup>
    );
}

function Field(props: {
    label: string;
    htmlFor: string;
    error?: string | undefined;
    hint?: string;
    required?: boolean;
    children: ReactNode;
}) {
    return (
        <div className="space-y-2">
            <Label htmlFor={props.htmlFor}>
                {props.label}
                {props.required && <span className="ml-1 text-destructive">*</span>}
            </Label>
            {props.children}
            {props.hint && !props.error && <p className="text-xs text-muted-foreground">{props.hint}</p>}
            {props.error && <p className="text-xs text-destructive">{props.error}</p>}
        </div>
    );
}

function ChoiceField(props: {
    label: string;
    options: ChoiceOption[];
    value: string;
    onChange: (value: string) => void;
    error?: string | undefined;
    hint?: string;
    required?: boolean;
}) {
    return (
        <div className="space-y-2">
            <Label>
                {props.label}
                {props.required && <span className="ml-1 text-destructive">*</span>}
            </Label>
            <RadioGroup value={props.value} onValueChange={props.onChange} className="grid gap-2.5 sm:grid-cols-2">
                {props.options.map((option) => {
                    const selected = props.value === option.value;
                    return (
                        <label
                            key={option.value}
                            className={cn(
                                CHOICE_CARD_BASE,
                                selected ? CHOICE_CARD_SELECTED : CHOICE_CARD_IDLE,
                            )}
                        >
                            <RadioGroupItem value={option.value} className="mt-0.5 shrink-0" />
                            <span>{option.label}</span>
                        </label>
                    );
                })}
            </RadioGroup>
            {props.hint && !props.error && <p className="text-xs text-muted-foreground">{props.hint}</p>}
            {props.error && <p className="text-xs text-destructive">{props.error}</p>}
        </div>
    );
}

function MultiChoiceField(props: {
    label: string;
    options: ChoiceOption[];
    selected: string[];
    onToggle: (value: string) => void;
    error?: string | undefined;
    hint?: string;
}) {
    return (
        <div className="space-y-2">
            <Label>
                {props.label}
                <span className="ml-1 text-destructive">*</span>
            </Label>
            <div className="grid gap-2.5 sm:grid-cols-2">
                {props.options.map((option) => {
                    const checked = props.selected.includes(option.value);
                    return (
                        <label
                            key={option.value}
                            className={cn(
                                CHOICE_CARD_BASE,
                                checked ? CHOICE_CARD_SELECTED : CHOICE_CARD_IDLE,
                            )}
                        >
                            <Checkbox
                                checked={checked}
                                onCheckedChange={() => props.onToggle(option.value)}
                                className="mt-0.5 shrink-0"
                            />
                            <span>{option.label}</span>
                        </label>
                    );
                })}
            </div>
            {props.hint && !props.error && <p className="text-xs text-muted-foreground">{props.hint}</p>}
            {props.error && <p className="text-xs text-destructive">{props.error}</p>}
        </div>
    );
}

function SummaryList({ values }: { values: RegistrationFormValues }) {
    const rows: Array<[string, string]> = [
        ['Nom et prénom', `${values.first_name} ${values.last_name}`.trim()],
        ['E-mail', values.email],
        ['Téléphone', values.phone],
        ['Résidence', [values.city, values.country].filter(Boolean).join(', ')],
        ['Situation', labelForChoice(SITUATION_OPTIONS, values.situation)],
        ['Niveau numérique', labelForChoice(DIGITAL_LEVEL_OPTIONS, values.digital_level)],
        ['Motivations', labelsForChoices(PARTICIPATION_REASON_OPTIONS, values.participation_reasons).join(', ')],
        ['Sujets', labelsForChoices(TOPIC_OPTIONS, values.topics).join(', ')],
    ];
    return (
        <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
            <p className="mb-3 text-sm font-semibold text-foreground">Récapitulatif</p>
            <dl className="space-y-2 text-sm">
                {rows.map(([label, value]) => (
                    <div key={label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                        <dt className="shrink-0 text-muted-foreground sm:w-40">{label}</dt>
                        <dd className="font-medium text-foreground">{value || '-'}</dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}
