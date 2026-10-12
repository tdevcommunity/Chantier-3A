// lib/api.js
//
// Thin, typed fetch wrapper for Tdev Festival's HTTP API (see docs/API.md).
// Every backend error is shaped { "error": { "code", "message" } } — we surface
// that as an `ApiError` instance so callers can branch on `.code` when useful
// and otherwise just show `.message`.
//
// Auth: the backend accepts either `Authorization: Bearer <session>` or the
// httpOnly `tdev_session` cookie. We keep a bearer token in localStorage
// (so the offline gate scanner can attach it to background sync requests
// without depending on cookies) and also send `credentials: "include"` so the
// cookie works out of the box for normal browser navigation/dev.

import type {
    AuthMeResponse,
    AuthSessionResponse,
    Org,
    OrgMember,
    OrgInvite,
    OrgInviteCreated,
    BankAccountView,
    Bank,
    PayoutSummary,
    FestivalEvent,
    EventImage,
    Category,
    Currency,
    EventStats,
    EventListResponse,
    CreateEventInput,
    UpdateEventInput,
    TicketType,
    Order,
    Ticket,
    AttendeesResponse,
    AdmissionConflictsResponse,
    VerifyPaymentResponse,
    ScanBundle,
} from './api-types.ts';

const DEFAULT_BASE = '/api';

function resolveBaseUrl() {
    const configured = import.meta.env.VITE_API_URL;
    if (configured && configured.trim()) {
        let base = configured.trim().replace(/\/+$/, '');
        // Production misconfig: Render/Vercel env often omits the /api suffix.
        if (/^https?:\/\//i.test(base) && !/\/api$/i.test(base)) {
            base = `${base}/api`;
        }
        return base;
    }
    return DEFAULT_BASE;
}

export const API_BASE_URL = resolveBaseUrl();

// `/media/{id}` is a public, unauthenticated route that sits beside `/api`,
// not under it (see docs/API.md) — strip a trailing "/api" from whatever
// base we resolved so media URLs still point at the right origin when
// VITE_API_URL is an absolute cross-origin URL, and stay root-relative in
// the common same-origin case.
const MEDIA_BASE_URL = API_BASE_URL.replace(/\/api\/?$/, '');

const TOKEN_KEY = 'tdev_token';

export function getToken(): string | null {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
}

export function setToken(token: string | null | undefined): void {
    try {
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
        } else {
            localStorage.removeItem(TOKEN_KEY);
        }
    } catch {
        // localStorage unavailable (private mode, etc.) — bearer auth just
        // won't persist across reloads; cookie auth still works.
    }
}

export interface ApiErrorOptions {
    code?: string;
    status?: number;
    cause?: unknown;
}

/** Error thrown for every non-2xx response and for network failures. */
export class ApiError extends Error {
    code: string;
    status: number;

    constructor(message: string, { code = 'unknown', status = 0, cause }: ApiErrorOptions = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        if (cause) this.cause = cause;
    }
}

type UnauthorizedListener = () => void;

// Subscribers notified whenever a request comes back 401. AuthProvider hooks
// in here to clear local session state and redirect to /login without a full
// page reload.
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
    unauthorizedListeners.add(listener);
    return () => unauthorizedListeners.delete(listener);
}

function notifyUnauthorized() {
    for (const listener of unauthorizedListeners) {
        try {
            listener();
        } catch {
            // never let a bad listener break the request pipeline
        }
    }
}

function buildQuery(params: Record<string, unknown> | null | undefined): string {
    if (!params) return '';
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        // Every query-params interface in this file widens to
        // `[key: string]: unknown` for extensibility, but a real query
        // param is always a primitive — an object/array here would silently
        // become "[object Object]"/"a,b,c" in the URL. Skip rather than
        // send it: a missing param the server treats as absent is a much
        // smaller failure than a garbled one it tries to parse.
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
        search.set(key, String(value));
    }
    const qs = search.toString();
    return qs ? `?${qs}` : '';
}

export interface RequestOptions extends Omit<RequestInit, 'method' | 'body' | 'headers'> {
    method?: string;
    /** query-string params, falsy values dropped */
    query?: Record<string, unknown> | null | undefined;
    /** JSON-serialisable request body */
    body?: unknown;
    /** don't fire onUnauthorized for this call */
    skipAuthRedirect?: boolean;
    headers?: Record<string, string>;
}

/**
 * Core request function. Resolves with the parsed JSON body on success.
 * Throws `ApiError` on any non-2xx response or network failure.
 *
 * @param path - path relative to the API base, e.g. "/events"
 */
export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', query, body, skipAuthRedirect = false, headers: extraHeaders, ...rest } = options;

    const url = `${API_BASE_URL}${path}${buildQuery(query)}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };

    const token = getToken();
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    let payload: string | undefined;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers,
            credentials: 'include',
            // `RequestInit` is a lib.dom type we can't widen, and
            // `exactOptionalPropertyTypes` treats an explicit `body:
            // undefined` differently from omitting the key — so omit it
            // outright when there is no payload rather than setting it to
            // undefined.
            ...(payload !== undefined ? { body: payload } : {}),
            ...rest,
        });
    } catch (cause) {
        throw new ApiError('Connexion réseau impossible.', { code: 'network_error', cause });
    }

    if (response.status === 204) {
        return null as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const data: unknown = isJson ? await response.json().catch(() => null) : await response.text().catch(() => null);

    if (!response.ok) {
        const errShape =
            data && typeof data === 'object' ? (data as { error?: { message?: unknown; code?: unknown } }).error : null;
        let message =
            (typeof errShape?.message === 'string' && errShape.message) ||
            (typeof data === 'string' && data.trim()) ||
            response.statusText ||
            'Request failed';
        if (response.status >= 500 || message === 'Internal Server Error' || message === 'Request failed') {
            message = 'Service billetterie temporairement indisponible.';
        }
        const code = (typeof errShape?.code === 'string' && errShape.code) || `http_${response.status}`;

        if (response.status === 401 && !skipAuthRedirect) {
            notifyUnauthorized();
        }

        throw new ApiError(message, { code, status: response.status });
    }

    return data as T;
}

const get = <T = unknown>(path: string, query?: Record<string, unknown> | null) => request<T>(path, { method: 'GET', query });
const post = <T = unknown>(path: string, body?: unknown, opts?: Partial<RequestOptions>) =>
    request<T>(path, { method: 'POST', body, ...opts });
const patch = <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body });
const put = <T = unknown>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body });
const del = <T = unknown>(path: string) => request<T>(path, { method: 'DELETE' });

/**
 * Multipart upload via XMLHttpRequest — `fetch` has no upload-progress
 * event, and the image uploader needs one. Mirrors `request()`'s auth +
 * error-shape handling (bearer token, ApiError, 401 -> onUnauthorized) so
 * callers get the same contract regardless of transport.
 */
function uploadFile<T = unknown>(
    path: string,
    file: File | Blob,
    { onProgress }: { onProgress?: (percent: number) => void } = {},
): Promise<T> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE_URL}${path}`, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Accept', 'application/json');
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        if (xhr.upload && typeof onProgress === 'function') {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
            };
        }

        xhr.onload = () => {
            let data: unknown = null;
            try {
                data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
            } catch {
                // non-JSON body — data stays null, message falls back below
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(data as T);
                return;
            }
            const errShape =
                data && typeof data === 'object' ? (data as { error?: { message?: unknown; code?: unknown } }).error : null;
            const message = (typeof errShape?.message === 'string' && errShape.message) || xhr.statusText || 'Upload failed';
            const code = (typeof errShape?.code === 'string' && errShape.code) || `http_${xhr.status}`;
            if (xhr.status === 401) notifyUnauthorized();
            reject(new ApiError(message, { code, status: xhr.status }));
        };
        xhr.onerror = () => reject(new ApiError('Connexion réseau impossible.', { code: 'network_error' }));

        const form = new FormData();
        form.append('file', file);
        xhr.send(form);
    });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const auth = {
    signup: (data: { email: string; password: string; name: string }) => post<AuthSessionResponse>('/auth/signup', data),
    login: (data: { email: string; password: string }) => post<AuthSessionResponse>('/auth/login', data),
    logout: () => post('/auth/logout'),
    // `me` takes options and MUST forward them. It used to be
    // `() => get('/auth/me')`, silently dropping the caller's argument —
    // and the caller that matters is AuthProvider's boot-time probe, which
    // passes {skipAuthRedirect:true} precisely because a signed-out
    // visitor's 401 here is normal, not a session expiry. With the option
    // dropped, every anonymous page load fired the global 401 handler,
    // which redirects to /login and (before this was fixed alongside)
    // dropped the query string doing it — so an invited person opening
    // /accept-invite?token=... signed out lost the token and was told
    // their link was missing one. `get`'s second parameter is `query`, so
    // the old form did not even fail loudly; it turned the option into a
    // querystring object and moved on.
    // no-unnecessary-type-assertion flags the `as Promise<AuthMeResponse>`
    // below, but it is NOT unnecessary — verified by removing it and
    // running `tsc --noEmit` directly, which then fails with three real
    // errors in context/use-auth.tsx (refresh()'s return type collapses to
    // Promise<unknown>, which callers destructuring `.user`/`.orgs` don't
    // type-check against). `request()`'s type parameter defaults to
    // `unknown` with nothing here to infer it from, so this cast is what
    // actually pins the return type; ESLint's isolated per-rule type
    // resolution appears to disagree with the full-program compiler on
    // this one expression shape (an assertion on an arrow function's
    // implicit-return call expression, inside an untyped object literal).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    me: (opts: Partial<RequestOptions> = {}) => request('/auth/me', { method: 'GET', ...opts }) as Promise<AuthMeResponse>,
    passwordReset: (email: string) => post('/auth/password-reset', { email }),
    passwordUpdate: (token: string, password: string) => post('/auth/password-update', { token, password }),
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface EventListParams {
    category?: string | undefined;
    host?: string | undefined;
    q?: string | undefined;
    [key: string]: unknown;
}

export interface AttendeesParams {
    q?: string | undefined;
    status?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
    [key: string]: unknown;
}

export const events = {
    /**
     * GET /api/events — the PUBLIC storefront listing: published events
     * only, regardless of caller (even an org admin/owner's own drafts are
     * excluded — see docs/API.md). Use `listForOrg` instead anywhere the
     * caller is managing their own org's events (Events list, dashboard,
     * payouts) — that route includes drafts.
     */
    list: (params?: EventListParams) => get<EventListResponse>('/events/', params),
    /**
     * GET /api/orgs/{id}/events — every event belonging to orgId,
     * regardless of status (draft/published/cancelled), most recently
     * created first. Requires scanner-or-above membership on the org.
     * This is what the organiser console's Events list/dashboard/payouts
     * pages should call — unlike `list`, it includes the caller's own
     * drafts.
     */
    listForOrg: (orgId: string) => get<{ events: FestivalEvent[] }>(`/orgs/${orgId}/events`),
    /**
     * The response carries more than the event itself — see
     * handleGetPublicEvent in internal/httpapi/event_handlers.go, which
     * always attaches the event's ticket types, issuer keys and gallery
     * in the same payload rather than requiring three round trips.
     */
    get: (slug: string) =>
        get<{
            event: FestivalEvent;
            ticket_types: TicketType[];
            issuer_keys: { event_id: string; keys: Record<string, string> };
            gallery: EventImage[];
        }>(`/events/${encodeURIComponent(slug)}`),
    create: (data: CreateEventInput) => post<{ event: FestivalEvent }>('/events', data),
    update: (id: string, data: UpdateEventInput) => patch<{ event: FestivalEvent }>(`/events/${id}`, data),
    /**
     * DELETE /api/events/{id} — admin+ auth. Refused (409 `conflict`) if
     * the event has ever had a ticket issued against it; cancel the event
     * instead (`update(id, { status: 'cancelled' })`) once that's true. See
     * docs/API.md for the full rule.
     */
    remove: (id: string) => del(`/events/${id}`),
    publish: (id: string) => post<{ event: FestivalEvent }>(`/events/${id}/publish`),
    stats: (id: string) => get<{ stats: EventStats }>(`/events/${id}/stats`),
    scanBundle: (id: string) => get<ScanBundle>(`/events/${id}/scan-bundle`),
    /**
     * Organizer/scanner-only attendee roster: { attendees, total, limit, offset }.
     * params may include { q, status, limit, offset } — all optional.
     */
    attendees: (id: string, params?: AttendeesParams) => get<AttendeesResponse>(`/events/${id}/attendees`, params),
    /**
     * GET /api/events/{id}/admission-conflicts — scanner-or-above auth. The
     * after-the-fact record of every ticket more than one gate device
     * admitted, because two partitioned gates cannot be stopped from doing
     * that — only found out about it once their logs sync. Shape:
     * { conflicts: [{ ticket_id, devices, extra_admissions, claims: [{
     * device_id, gate_id, scanned_at, result, server_result?, note }] }],
     * extra_admissions, algebra, engine, complete, caveat }. See
     * pages/organizers/events/event/admission-reconciliation.js for how this
     * is shaped for the screen, and docs/OFFLINE-GATES.md for what it does
     * and does not claim.
     */
    admissionConflicts: (id: string) => get<AdmissionConflictsResponse>(`/events/${id}/admission-conflicts`),
    /**
     * GET /api/events/{id}/orders — admin+ auth. Every order placed
     * against the event, most recent first: { orders: [{...,
     * marked_by, marked_at}] }. This is the organiser orders screen's
     * data source — see the `orders` export below for the mark-paid/
     * mark-failed actions on top of it.
     */
    orders: (id: string) => get<{ orders: Order[] }>(`/events/${id}/orders`),
};

// ---------------------------------------------------------------------------
// Event images (cover + gallery)
// ---------------------------------------------------------------------------

/**
 * `POST /api/events/{id}/images` multipart upload -> {id,url,width,height}.
 * `DELETE /api/images/{id}` removes a stored image. `url(id)` is the public,
 * unauthenticated `/media/{id}` byte-serving route — safe to drop straight
 * into an <img src>.
 */
export const images = {
    upload: (eventId: string, file: File | Blob, opts?: { onProgress?: (percent: number) => void }) =>
        uploadFile<EventImage>(`/events/${eventId}/images`, file, opts),
    remove: (id: string) => del(`/images/${id}`),
    url: (id: string | null | undefined) => (id ? `${MEDIA_BASE_URL}/media/${id}` : null),
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Event categories, derived server-side from published events:
 * [{ slug, label, count }]. Used to drive the landing page's category tabs
 * and the browse page's ?category= filter. Callers should treat a failure
 * here as "no categories to show" rather than a page-level error — category
 * tabs are a filter convenience, not critical path.
 */
export const categories = {
    // docs/API.md specifies a bare array; the type admits the
    // `{ categories: [...] }` envelope too because `useCategories` tolerates
    // it defensively (see src/pages/visitor/events/use-categories.ts).
    list: () => get<Category[] | { categories: Category[] }>('/categories'),
};

/**
 * The full ISO-4217 currency table Tdev Festival knows about (internal/money):
 * [{ code, name, exponent }]. Drives the event-creation/edit currency
 * picker — Tdev Festival has no privileged currency, so this is deliberately the
 * whole table, not a hardcoded handful of "common" ones.
 */
export const currencies = {
    list: () => get<{ currencies: Currency[] }>('/currencies'),
};

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

/** Body of POST /api/events/{id}/ticket-types and PATCH /api/ticket-types/{id}. */
export interface TicketTypeInput {
    name?: string | undefined;
    description?: string | undefined;
    price_minor?: number | undefined;
    quantity_total?: number | undefined;
    sales_start?: string | null | undefined;
    sales_end?: string | null | undefined;
    max_per_order?: number | undefined;
    status?: string | undefined;
    sort_order?: number | undefined;
    product_kind?: 'ticket' | 'goodie' | 'option' | undefined;
}

export const siteConfig = {
    get: () => get<import('@/lib/site-config').SiteConfig>('/public/site-config'),
};

export const publicContact = {
    send: (data: { name: string; email: string; subject: string; message: string }) =>
        post<{ ok: boolean }>('/public/contact', data),
};

export const ticketTypes = {
    list: (eventId: string) => get<{ ticket_types: TicketType[] }>(`/events/${eventId}/ticket-types`),
    create: (eventId: string, data: TicketTypeInput) => post<{ ticket_type: TicketType }>(`/events/${eventId}/ticket-types`, data),
    update: (id: string, data: TicketTypeInput) => patch<{ ticket_type: TicketType }>(`/ticket-types/${id}`, data),
    remove: (id: string) => del(`/ticket-types/${id}`),
};

// ---------------------------------------------------------------------------
// Organisations
// ---------------------------------------------------------------------------

export interface CreateOrgInput {
    name: string;
    slug?: string | undefined;
    default_currency?: string | undefined;
}

export const orgs = {
    /**
     * POST /api/orgs {name, slug?, default_currency?} — any authenticated
     * user; the caller becomes the new org's `owner`. Returns
     * { org: {id, name, slug, default_currency, role} }.
     *
     * This is the route that makes a brand new account usable: signup
     * creates ONLY a user, so until an org exists every organiser surface
     * (events, ticket types, orders, the gate, stats, team, payouts) has
     * nothing to hang off.
     *
     * `slug` is optional and derived from the name when omitted. It is a
     * GLOBAL namespace, so a taken one is refused with 409 `conflict` —
     * surface that to the user as "pick another", never as a generic
     * failure. Creating an org grants no access to any other org.
     */
    create: (data: CreateOrgInput) => post<{ org: Org }>('/orgs', data),
};

// ---------------------------------------------------------------------------
// Org members & invites
// ---------------------------------------------------------------------------

export interface CreateInviteInput {
    email: string;
    role: string;
}

export const orgMembers = {
    list: (orgId: string) => get<{ members: OrgMember[] }>(`/orgs/${orgId}/members`),
    invites: (orgId: string) => get<{ invites: OrgInvite[] }>(`/orgs/${orgId}/invites`),
    invite: (orgId: string, data: CreateInviteInput) => post<OrgInviteCreated>(`/orgs/${orgId}/invites`, data),
    revokeInvite: (inviteId: string) => del(`/invites/${inviteId}`),
    acceptInvite: (token: string) => post<{ org_id: string; role: string }>('/invites/accept', { token }),
    /**
     * PATCH /api/orgs/{id}/members/{user_id} {role} — owner-only. Refused
     * (409 `conflict`) if it would demote the org's last remaining owner
     * — see docs/API.md.
     */
    updateRole: (orgId: string, userId: string, role: string) => patch(`/orgs/${orgId}/members/${userId}`, { role }),
};

// ---------------------------------------------------------------------------
// Payouts & bank details
// ---------------------------------------------------------------------------

export interface SetBankAccountInput {
    bank_code: string;
    account_number: string;
    account_name: string;
}

/**
 * Bank account numbers are masked on read (see docs/API.md) — a GET here
 * is for display only, never pre-fill an edit form's account-number field
 * from it. `banks.list()` is the provider's (Paystack) bank list, used to
 * populate the bank-code select.
 */
export const payoutsApi = {
    bankAccount: (orgId: string) => get<{ bank_account: BankAccountView }>(`/orgs/${orgId}/bank-account`),
    setBankAccount: (orgId: string, data: SetBankAccountInput) => put(`/orgs/${orgId}/bank-account`, data),
    banks: () => get<{ banks: Bank[] }>('/banks'),
    forEvent: (eventId: string) => get<{ payouts: PayoutSummary }>(`/events/${eventId}/payouts`),
};

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface CreateOrderBuyer {
    email: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    school_name?: string;
    motivation?: string;
    wish?: string;
    /** Formulaire participant complet (TDEV Festival 2026), validé côté serveur. */
    form?: Record<string, unknown>;
}

export interface CreateOrderInput {
    event_id: string;
    items: Array<{ ticket_type_id: string; quantity: number }>;
    buyer: CreateOrderBuyer;
    provider?: string;
    return_path?: string;
}

export interface CreateOrderResponse {
    order: Order;
    payment: {
        provider: string;
        redirect_url?: string;
        reference?: string;
        instructions?: string;
        /** Identifiant de transaction pour le widget Checkout.js (FedaPay). */
        client_token?: string;
    };
}

export interface MarkOrderResponse {
    order: Order;
    tickets?: Ticket[];
}

export interface PassTierCatalogEntry {
    id: string;
    label: string;
    available: boolean;
    price_minor?: number;
}

export const passTiers = {
    list: () => get<{ pass_tiers: PassTierCatalogEntry[] }>('/pass-tiers'),
};

export const orders = {
    create: (data: CreateOrderInput) => post<CreateOrderResponse>('/orders', data),
    list: () => get<{ orders: Order[] }>('/orders'),
    get: (id: string) => get<{ order: Order }>(`/orders/${id}`),
    getGuest: (id: string, email: string) =>
        get<{ order: Order; tickets?: Ticket[] }>(`/orders/${id}/guest?${new URLSearchParams({ email }).toString()}`),
    guestTicketPngUrl: (orderId: string, email: string, ticketId?: string) => {
        const q = new URLSearchParams({ email });
        if (ticketId) q.set('ticket', ticketId);
        return `${API_BASE_URL}/orders/${orderId}/guest/ticket.png?${q.toString()}`;
    },
    guestTicketPdfUrl: (orderId: string, email: string, ticketId?: string) => {
        const q = new URLSearchParams({ email });
        if (ticketId) q.set('ticket', ticketId);
        return `${API_BASE_URL}/orders/${orderId}/guest/ticket.pdf?${q.toString()}`;
    },
    /**
     * POST /api/orders/{id}/mark-paid — admin+ on the order's event's org.
     * Settles a `manual`-provider order (bank transfer / cash at the door /
     * invoice — see PAYMENTS.md) and issues its tickets, exactly like any
     * other provider's webhook or verify poll would. Idempotent: calling
     * this again on an already-paid order returns the same tickets rather
     * than issuing more.
     */
    markPaid: (id: string) => post<MarkOrderResponse>(`/orders/${id}/mark-paid`),
    /**
     * POST /api/orders/{id}/mark-failed — admin+ on the order's event's
     * org. Records that a manual order will never be paid and releases the
     * inventory it had reserved back to sale.
     */
    markFailed: (id: string) => post<MarkOrderResponse>(`/orders/${id}/mark-failed`),
};

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const payments = {
    status: (reference: string, veltoTransactionId?: string) =>
        post<{ payment_status: string; order_status: string }>('/payments/status', {
            reference,
            ...(veltoTransactionId ? { velto_transaction_id: veltoTransactionId } : {}),
        }),
    verify: (reference: string, veltoTransactionId?: string) =>
        post<VerifyPaymentResponse>('/payments/verify', {
            reference,
            ...(veltoTransactionId ? { velto_transaction_id: veltoTransactionId } : {}),
        }),
    abandon: (reference: string, email: string) =>
        post<{ order: Order; released: boolean }>('/payments/abandon', { reference, email }),
};

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const tickets = {
    list: () => get<{ tickets: Ticket[] }>('/tickets'),
    get: (id: string) => get<{ ticket: Ticket }>(`/tickets/${id}`),
    pdfUrl: (id: string) => `${API_BASE_URL}/tickets/${id}/pdf`,
};

// ---------------------------------------------------------------------------
// Offline gate scan
// ---------------------------------------------------------------------------

export interface ScanSubmitInput {
    event_id: string;
    token: string;
    device_id: string;
    gate_id?: string;
}

export const scan = {
    bundle: (eventId: string) => get<ScanBundle>(`/events/${eventId}/scan-bundle`),
    submit: (data: ScanSubmitInput) => post('/scan', data),
    sync: (admissions: unknown[]) => post('/scan/sync', { admissions }),
};

export default {
    request,
    auth,
    events,
    categories,
    images,
    orgMembers,
    payoutsApi,
    ticketTypes,
    orders,
    payments,
    tickets,
    scan,
    getToken,
    setToken,
    onUnauthorized,
    ApiError,
};
