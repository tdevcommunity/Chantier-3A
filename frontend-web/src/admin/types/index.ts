// Types TypeScript reflétant fidèlement le schéma PostgreSQL Neon de TDEV Billetterie.
// Aucune donnée sensible (password_hash, private_key, secrets) n'est exposée côté frontend.

export type OrderStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
export type TicketStatus = 'valid' | 'void' | 'refunded';
export type AdmissionResult = 'admitted' | 'duplicate' | 'invalid' | 'wrong_event';
export type EventStatus = 'draft' | 'published' | 'cancelled';
export type ProductKind = 'ticket' | 'goodie' | 'option';
export type PassTier = 'student' | 'standard' | 'vip';
export type OrgRole = 'owner' | 'admin' | 'scanner';
export type EmailStatus = 'pending' | 'sent' | 'failed';

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
  email_verified_at?: string | null;
  role?: OrgRole;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  default_currency: string;
}

export interface OrganizationMember {
  org_id: string;
  user_id: string;
  role: OrgRole;
  created_at: string;
  user?: User;
}

export interface Event {
  id: string;
  org_id: string;
  slug: string;
  title: string;
  summary: string;
  description: string;
  venue_name: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  cover_image: string;
  status: EventStatus;
  currency: string;
  created_at: string;
  updated_at: string;
  category: string;
  cover_image_id?: string | null;
}

export interface TicketType {
  id: string;
  event_id: string;
  name: string;
  description: string;
  price_minor: number;
  quantity_total: number;
  quantity_sold: number;
  sales_start?: string | null;
  sales_end?: string | null;
  max_per_order: number;
  status: string;
  sort_order: number;
  pass_tier?: PassTier | null;
  product_kind: ProductKind;
}

export interface OrderItem {
  id: string;
  order_id: string;
  ticket_type_id: string;
  quantity: number;
  unit_price_minor: number;
  ticket_type?: TicketType;
}

export interface OrderRegistration {
  first_name?: string;
  last_name?: string;
  email?: string;
  school_name?: string;
  motivation?: string;
  wish?: string;
  form?: Record<string, unknown>;
}

export interface Order {
  id: string;
  event_id: string;
  user_id?: string | null;
  buyer_email: string;
  buyer_name: string;
  buyer_first_name?: string;
  buyer_last_name?: string;
  school_name?: string;
  motivation?: string;
  wish?: string;
  registration?: OrderRegistration;
  status: OrderStatus;
  subtotal_minor: number;
  fee_minor: number;
  total_minor: number;
  currency: string;
  provider: string;
  provider_ref?: string | null;
  created_at: string;
  paid_at?: string | null;
  items?: OrderItem[];
}

export interface Ticket {
  id: string;
  order_id: string;
  event_id: string;
  ticket_type_id: string;
  holder_user_id?: string | null;
  holder_name: string;
  serial: string;
  capability: string;
  status: TicketStatus;
  issued_at: string;
  voided_at?: string | null;
  ticket_type?: TicketType;
}

export interface Admission {
  id: string;
  ticket_id: string;
  event_id: string;
  gate_id: string;
  scanned_by?: string | null;
  device_id: string;
  scanned_at: string;
  result: AdmissionResult;
  note: string;
  holder_name?: string;
  serial?: string;
  pass_name?: string;
}

export interface PaymentRecord {
  provider: string;
  reference: string;
  amount_minor: number;
  currency: string;
  status: string;
  instructions: string;
  marked_by: string;
  marked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payout {
  id: string;
  event_id: string;
  org_id: string;
  amount_minor: number;
  status: string;
  provider_ref?: string | null;
  created_at: string;
  paid_at?: string | null;
  currency: string;
  event_title?: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  unread: boolean;
  created_at: string;
}

export interface OutboundEmail {
  id: string;
  order_id?: string | null;
  template: string;
  to_email: string;
  subject: string;
  body_text: string;
  status: EmailStatus;
  error?: string | null;
  created_at: string;
  sent_at?: string | null;
}

export interface SyncPeer {
  id: string;
  org_id: string;
  name: string;
  url: string;
  public_key: string;
  enabled: number;
  pull_cursor: number;
  push_cursor: number;
  last_sync_at: string;
  last_status: string;
  created_at: string;
  feed_publish: number;
  feed_subscribe: number;
  feed_pulled_at?: string | null;
  feed_status?: string | null;
}

export interface SyncOp {
  seq: number;
  op_id: string;
  event_id: string;
  author: string;
  delivered_by: string;
  claim_ticket: string;
  claim_device: string;
  claim_scanned_at: string;
  applied: number;
  cose: string;
  created_at: string;
}

export interface CompensatingPaymentAudit {
  id: string;
  original_reference: string;
  payout_reference: string;
  rail_id: string;
  destination: string;
  sender_address_known: boolean;
  sender_address: string;
  status: string;
  reason: string;
  is_refusal: boolean;
  same_as_sender_address: boolean;
  refused: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  executed: boolean;
  amount_minor: number;
  currency: string;
  created_at: string;
}

export interface EventLog {
  id: string;
  action: string;
  description: string;
  created_at: string;
}

export interface SystemSetting {
  key: string;
  value: string;
}

// Vue enrichie pour les participants
export interface Participant {
  /** Identifiant de ligne (order_id : une inscription, même si plusieurs billets). */
  id: string;
  ticket_id: string;
  ticket_ids: string[];
  order_id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  school: string;
  serial: string;
  pass_name: string;
  pass_tier?: PassTier | null;
  order_status: OrderStatus;
  amount_minor: number;
  currency: string;
  issued_at: string;
  is_nexus: boolean;
  has_goodies: boolean;
  goodies_details?: string;
  admitted: boolean;
  registration_form: Record<string, unknown>;
  /** Statut de chaque billet lié à la commande. */
  ticket_statuses: TicketStatus[];
  /** Tous les billets sont void ou refunded. */
  is_revoked: boolean;
}

export interface DashboardKPIData {
  participants_count: number;
  paid_participants_count?: number;
  tickets_sold: number;
  tickets_total: number;
  nexus_night_count: number;
  nexus_night_revenue_minor: number;
  admissions_count: number;
  scans_total?: number;
  pending_orders_count?: number;
  revenue_minor?: number;
  currency?: string;
  scan_rate?: number;
}
