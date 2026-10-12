import { orders as ordersApi, payments as paymentsApi } from '@/lib/api';
import type { TicketType } from '@/lib/api-types';
import {
    toRegistrationFormPayload,
    labelsForChoices,
    PARTICIPATION_REASON_OPTIONS,
    type RegistrationFormValues,
} from '@/lib/registration-form';

export type CheckoutOutcome =
    | { kind: 'free_confirmed'; orderId: string; email: string }
    | { kind: 'paid'; orderId: string; email: string }
    | { kind: 'paid_pending'; orderId: string; email: string; redirectUrl?: string };

export async function completeCheckout(params: {
    eventId: string;
    ticketType: TicketType;
    registration: RegistrationFormValues;
    onPaymentStart?: () => void;
    returnPath?: string;
}): Promise<CheckoutOutcome> {
    const { eventId, ticketType, registration, onPaymentStart, returnPath } = params;
    const form = toRegistrationFormPayload(registration);
    const first = form.first_name;
    const last = form.last_name;
    const email = form.email;
    const name = `${first} ${last}`.trim();

    const path =
        returnPath ??
        (() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('velto_return');
            url.searchParams.delete('order');
            url.searchParams.delete('status');
            url.searchParams.delete('id');
            url.searchParams.delete('transaction_id');
            url.searchParams.delete('token');
            url.searchParams.delete('external_reference');
            return `${url.pathname}${url.search}`;
        })();

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
        return_path: path || '/',
        provider: 'velto',
    });

    const order = result.order;
    const paid = order.total_minor > 0;

    if (paid) {
        onPaymentStart?.();
        const redirectUrl = result.payment?.redirect_url?.trim();
        if (redirectUrl) {
            return { kind: 'paid_pending', orderId: order.id, email, redirectUrl };
        }
        return { kind: 'paid_pending', orderId: order.id, email };
    }

    try {
        await paymentsApi.verify(order.id);
    } catch {
        /* Déjà réglé côté serveur pour les commandes gratuites */
    }
    return { kind: 'free_confirmed', orderId: order.id, email };
}
