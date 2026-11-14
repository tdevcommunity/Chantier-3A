import { orders as ordersApi, payments as paymentsApi } from '@/lib/api';
import type { TicketType } from '@/lib/api-types';
import {
    toRegistrationFormPayload,
    labelsForChoices,
    PARTICIPATION_REASON_OPTIONS,
    type RegistrationFormValues,
} from '@/lib/registration-form';

/** Déclaration d'un transfert Mobile Money fait manuellement par le client. */
export interface ManualPaymentDeclaration {
    operator: string;
    reference: string;
    phone: string;
}

export type CheckoutOutcome =
    | { kind: 'free_confirmed'; orderId: string; email: string }
    /** Paiement déclaré : en attente de vérification par l'équipe (pas de billet tant que non validé). */
    | { kind: 'pending_verification'; orderId: string; email: string; totalMinor: number };

export async function completeCheckout(params: {
    eventId: string;
    ticketType: TicketType;
    registration: RegistrationFormValues;
    /** Obligatoire pour un pass payant. */
    manualPayment?: ManualPaymentDeclaration;
}): Promise<CheckoutOutcome> {
    const { eventId, ticketType, registration, manualPayment } = params;
    const form = toRegistrationFormPayload(registration);
    const first = form.first_name;
    const last = form.last_name;
    const email = form.email;
    const name = `${first} ${last}`.trim();
    const isPaid = ticketType.price_minor > 0;

    if (isPaid && !manualPayment) {
        throw new Error('Veuillez renseigner votre paiement.');
    }

    const result = await ordersApi.create({
        event_id: eventId,
        items: [{ ticket_type_id: ticketType.id, quantity: 1 }],
        buyer: {
            email,
            first_name: first,
            last_name: last,
            name,
            motivation: labelsForChoices(PARTICIPATION_REASON_OPTIONS, form.participation_reasons).join(', '),
            wish: form.expectations,
            school_name: form.school_program,
            form,
        },
        ...(isPaid ? { provider: 'manual_momo', manual_payment: manualPayment } : {}),
    });

    const order = result.order;

    if (order.total_minor > 0) {
        return { kind: 'pending_verification', orderId: order.id, email, totalMinor: order.total_minor };
    }

    try {
        await paymentsApi.verify(order.id, email);
    } catch {
        /* Déjà réglé côté serveur pour les commandes gratuites */
    }
    return { kind: 'free_confirmed', orderId: order.id, email };
}
