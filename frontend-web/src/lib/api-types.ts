// lib/api-types.ts
//
// The wire shapes lib/api.ts's methods return, mirroring the Go DTOs they
// come from (internal/events, internal/orders, internal/orgs,
// internal/httpapi/*_handlers.go, internal/scan). These are TYPES ONLY —
// nothing here changes at runtime — added so the frontend's biggest single
// dependency (every page calls through lib/api.ts) has real shapes instead
// of implicit `any`.
//
// Where a Go handler builds its response with encoding/json's zero-value
// defaults (an omitted `omitempty` field simply isn't sent), the
// corresponding field here is marked optional rather than required, so a
// caller cannot assume a field is present just because the type says
// "string" — exactly the discipline internal/*'s own json tags encode.

// ── Auth ─────────────────────────────────────────────────────────────────

export interface User {
    id: string;
    email: string;
    name: string;
    created_at: string;
    email_verified_at?: string;
}

export interface OrgMembership {
    id: string;
    name: string;
    role: string;
}

export interface AuthMeResponse {
    user: User;
    orgs: OrgMembership[];
}

/** POST /auth/signup and /auth/login share this response shape. */
export interface AuthSessionResponse {
    user: User;
    token: string;
}

// ── Organisations ────────────────────────────────────────────────────────

export interface Org {
    id: string;
    name: string;
    slug: string;
    default_currency: string;
    /** The caller's role in this org — present on org-scoped responses. */
    role?: string;
}

export interface OrgMember {
    user_id: string;
    name: string;
    email: string;
    role: string;
}

export interface OrgInvite {
    invite_id: string;
    email: string;
    role: string;
    expires_at: string;
    created_at: string;
}

/** The plaintext invite token, returned exactly once from `orgMembers.invite()`. */
export interface OrgInviteCreated {
    invite_id: string;
    /** True when the backend created a new staff account for this e-mail. */
    account_created?: boolean;
    /** Initial password when `account_created` is true (default staff password). */
    default_password?: string;
    /** True when SMTP is configured and an invite e-mail was queued. */
    email_sent?: boolean;
    token: string;
    expires_at: string;
}

export interface BankAccountView {
    bank_code: string;
    bank_name: string;
    account_name: string;
    account_number_last4: string;
}

export interface Bank {
    name: string;
    slug: string;
    code: string;
    currency: string;
    active: boolean;
}

export interface PayoutRow {
    id: string;
    amount_minor: number;
    currency: string;
    status: string;
    provider_ref?: string;
    created_at: string;
    paid_at?: string;
}

export interface PayoutSummary {
    gross_minor: number;
    fees_minor: number;
    net_minor: number;
    currency: string;
    status: string;
    rows: PayoutRow[];
}

// ── Events ───────────────────────────────────────────────────────────────

export interface FestivalEvent {
    id: string;
    org_id: string;
    slug: string;
    title: string;
    summary: string;
    description: string;
    venue_name: string;
    address: string;
    lat?: number;
    lng?: number;
    starts_at: string;
    ends_at: string;
    timezone: string;
    cover_image: string;
    /** 'draft' | 'published' | 'cancelled' */
    status: string;
    currency: string;
    category: string;
    cover_image_id?: string | undefined;
    created_at: string;
    updated_at: string;
}

export interface EventImage {
    id: string;
    url: string;
    width: number;
    height: number;
}

export interface Category {
    slug: string;
    label: string;
    count: number;
}

export interface Currency {
    code: string;
    name: string;
    exponent: number;
}

export interface TicketTypeStats {
    ticket_type_id: string;
    name: string;
    sold: number;
    quantity_total: number;
    revenue_minor: number;
}

export interface EventStats {
    sold: number;
    revenue_minor: number;
    admitted: number;
    by_type: TicketTypeStats[];
}

/** The `host` envelope on GET /api/events — see lib/host.ts. */
export interface HostView {
    scope?: string;
    name?: string;
    multi_org?: boolean;
    peers_included?: boolean;
    organisations?: Array<{ id: string; name: string; slug: string }>;
    org?: { id: string; name: string; slug: string };
}

export interface EventListResponse {
    events: FestivalEvent[];
    host?: HostView;
}

/** Body of POST /api/events — org_id plus internal/events.CreateEventInput's own fields (see handleCreateEvent in internal/httpapi/event_handlers.go, which decodes both from the same request body). */
export interface CreateEventInput {
    org_id: string;
    slug: string;
    title: string;
    summary: string;
    description: string;
    venue_name: string;
    address: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    starts_at: string;
    ends_at: string;
    timezone: string;
    cover_image: string;
    currency: string;
    category: string;
}

/** Body of PATCH /api/events/{id} — every field optional, absent/undefined means "leave unchanged". */
export interface UpdateEventInput {
    slug?: string | undefined;
    title?: string | undefined;
    summary?: string | undefined;
    description?: string | undefined;
    venue_name?: string | undefined;
    address?: string | undefined;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    starts_at?: string | undefined;
    ends_at?: string | undefined;
    timezone?: string | undefined;
    cover_image?: string | undefined;
    currency?: string | undefined;
    status?: string | undefined;
    category?: string | undefined;
    cover_image_id?: string | undefined;
}

// ── Ticket types ─────────────────────────────────────────────────────────

export interface TicketType {
    id: string;
    event_id: string;
    name: string;
    description: string;
    price_minor: number;
    quantity_total: number;
    quantity_sold: number;
    sales_start?: string;
    sales_end?: string;
    max_per_order: number;
    /** Sale status, e.g. "on_sale" or the not-for-sale state. */
    status: string;
    sort_order: number;
    product_kind?: 'ticket' | 'goodie' | 'option';
    pass_tier?: 'student' | 'standard' | 'vip' | string;
}

// ── Orders / tickets ─────────────────────────────────────────────────────

export interface OrderItem {
    id: string;
    ticket_type_id: string;
    quantity: number;
    unit_price_minor: number;
}

export interface OrderRegistration {
    first_name: string;
    last_name: string;
    email: string;
    school_name?: string;
    motivation?: string;
    wish?: string;
    /** Réponses complètes au formulaire participant (vide pour les anciennes commandes). */
    form?: Record<string, unknown>;
}

export interface Order {
    id: string;
    event_id: string;
    user_id?: string;
    buyer_email: string;
    buyer_name: string;
    registration?: OrderRegistration;
    /** 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled' */
    status: string;
    subtotal_minor: number;
    fee_minor: number;
    total_minor: number;
    currency: string;
    provider: string;
    provider_ref?: string;
    created_at: string;
    paid_at?: string;
    items?: OrderItem[];
    /** Set by the manual provider's mark-paid/mark-failed audit trail. */
    marked_by?: string;
    marked_at?: string;
}

export interface Ticket {
    id: string;
    order_id: string;
    event_id: string;
    ticket_type_id: string;
    holder_user_id?: string;
    holder_name: string;
    serial: string;
    capability: string;
    /** 'valid' | 'void' | 'refunded' */
    status: string;
    issued_at: string;
    voided_at?: string;
    // Present on the buyer-facing "my tickets" list — best-effort
    // enrichment, so absent rather than empty when the lookup failed.
    event_title?: string;
    event_venue_name?: string;
    event_starts_at?: string;
    ticket_type_name?: string;
}

export interface AttendeeRow {
    ticket_id: string;
    order_id: string;
    serial: string;
    holder_name: string;
    status: string;
    ticket_type_id: string;
    ticket_type_name: string;
    issued_at: string;
    voided_at?: string;
    admitted_at?: string;
    admitted: boolean;
}

export interface AttendeesResponse {
    attendees: AttendeeRow[];
    total: number;
    limit: number;
    offset: number;
}

export interface VerifyPaymentResponse {
    order: Order;
    tickets: Ticket[];
}

// ── Admission reconciliation ─────────────────────────────────────────────

export interface AdmissionClaimView {
    device_id: string;
    gate_id?: string;
    scanned_at: string;
    result: string;
    server_result?: string;
    note?: string;
}

export interface AdmissionConflictView {
    ticket_id: string;
    devices: number;
    extra_admissions: number;
    claims: AdmissionClaimView[];
}

export interface AdmissionConflictsResponse {
    conflicts: AdmissionConflictView[];
    extra_admissions: number;
    algebra: string;
    engine: string;
    complete: boolean;
    caveat: string;
}

// ── Offline gate scan bundle ─────────────────────────────────────────────

export interface ScanEventMeta {
    event_id: string;
    title: string;
    venue_name: string;
    starts_at: string;
    ends_at: string;
}

export interface ScanAllocation {
    id: string;
    event_id: string;
    device_id: string;
    ticket_type_id: string;
    count: number;
    issued_at: string;
    expires_at: string;
    kid: string;
}

export interface ScanBundle {
    event: ScanEventMeta;
    issuer_keys: { event_id: string; keys: Record<string, string> };
    ticket_index: string[];
    ticket_index_present: boolean;
    admitted_index?: string[];
    allocation?: ScanAllocation;
    issued_at: string;
}
