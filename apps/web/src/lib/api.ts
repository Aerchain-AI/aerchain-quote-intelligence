/** Thin fetch layer. Every screen renders whatever the pipeline actually produced —
 * there are no hardcoded prices or vendor names anywhere in this app. */

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? detail.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? detail.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail ?? detail.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ------------------------------------------------------------------- types

export interface Buyer {
  id: string;
  name: string;
  email: string;
  team: string;
}

export interface Rfx {
  id: string;
  name: string;
  category: string;
  requiredByDate: string;
  currency: string;
  description: string;
  status?: string;
  sourceRequest?: string | null;
  createdAt?: string;
  buyerId?: string | null;
  buyer?: Buyer | null;
  lineItems?: LineItem[];
  _count?: { lineItems: number; vendors: number };
}

export interface SimilarRfx {
  id: string;
  name: string;
  category: string;
  status: string;
  currency: string;
  createdAt: string;
  requiredByDate: string;
  buyerName: string | null;
  lineItemCount: number;
  score: number;
  matchedOn: string[];
  sampleLineItems: string[];
}

export interface ClarifyOption {
  label: string;
  value: string;
  description: string;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  why: string;
  options: ClarifyOption[];
  multiSelect: boolean;
  allowFreeText: boolean;
  priority?: "blocking" | "important";
}

export interface DraftLineItem {
  name: string;
  specification: string;
  quantity: number;
  unit: string;
}

export interface TimelineEntry {
  id: string;
  type: string;
  title: string;
  detail: string | null;
  actor: string | null;
  occurredAt: string;
  source: "stored" | "derived";
}

export interface RfxDetail extends Rfx {
  timeline: TimelineEntry[];
  vendors: Array<{
    id: string;
    name: string;
    responseFormat: string;
    status: string;
    itemsFoundCount: number | null;
    itemsMissingCount: number | null;
    overallConfidence: number | null;
  }>;
  clarifications: Array<{ question: string; answer: string }> | null;
}

export interface Supplier {
  id: string;
  name: string;
  email: string;
  category: string;
  pastWork: string | null;
  eventsInvited: number;
  eventsQuoted: number;
  eventsAwarded: number;
  avgResponseDays: number | null;
  onTimeDeliveryPct: number | null;
  qualityScore: number | null;
  lastEngagedAt: string | null;
  isNew: boolean;
  quoteRate: number | null;
  winRate: number | null;
  alreadyInvited: boolean;
}

export interface SupplierShortlist {
  category: string;
  suppliers: Supplier[];
  note: string;
}

export interface ComposedEmail {
  subject: string;
  body: string;
  lineItemCount: number;
  hasCommercialTerms: boolean;
}

export interface IssueResult {
  issuedAt: string;
  invited: Array<{ id: string; name: string; email: string; isNew: boolean }>;
  status: string;
}

export interface RfxInvitation {
  id: string;
  email: string;
  emailSubject: string;
  emailBody: string;
  status: string;
  sentAt: string;
  supplier: Supplier;
}

export interface RfxFacets {
  years: number[];
  categories: string[];
  statuses: string[];
  buyers: Buyer[];
}

export interface SimilarPastProcurement {
  externalId: string;
  title: string;
  category: string;
  completedAt: string;
  awardedVendorName: string;
  awardValueInr: number;
  savingsInr: number | null;
  savingsPct: number | null;
  score: number;
  matchedOn: string[];
  basis: string;
}

export interface ClarifyResult {
  interpretation: string;
  detectedCategory: string;
  alreadyKnown: string[];
  itemsDraft?: DraftLineItem[];
  questions: ClarifyQuestion[];
  similar: SimilarRfx[];
  /** Closed procurement matching the request. Context only — no line items to copy. */
  priorProcurement?: SimilarPastProcurement[];
}

export interface LineItem {
  id: number;
  name: string;
  specification: string;
  quantity: number;
  unit: string;
}

export interface VendorSummary {
  id: string;
  name: string;
  responseFormat: string;
  status: string;
  itemsFoundCount: number | null;
  itemsMissingCount: number | null;
  overallConfidence: number | null;
  processedAt: string | null;
}

export interface Quote {
  id: string;
  vendorId: string;
  lineItemId: number;
  sourceValue: number | null;
  sourceCurrency: string | null;
  sourceUnit: string | null;
  normalizedValue: number | null;
  normalizedCurrency: string;
  normalizedUnit: string;
  aiInterpretedValue: number | null;
  aiInterpretedCurrency: string | null;
  aiInterpretedUnit: string | null;
  evaluatedValue: number | null;
  confidence: number | null;
  confidenceLevel: string | null;
  status: string;
  sourceDocument: string | null;
  sourceLocation: string | null;
  sourceExcerpt: string | null;
  discountJson: string | null;
  freightJson: string | null;
  taxJson: string | null;
  fxRateJson: string | null;
  notes: string | null;
}

export interface QuoteException {
  id: string;
  vendorId: string;
  lineItemId: number | null;
  type: string;
  message: string;
  severity: string;
  vendorName?: string | null;
  lineItemName?: string | null;
}

export interface ComparisonCell {
  vendorId: string;
  vendorName: string;
  quote: Quote | null;
  exceptions: QuoteException[];
}

export interface ComparisonRow {
  lineItem: LineItem;
  cells: ComparisonCell[];
}

export interface Comparison {
  vendors: VendorSummary[];
  rows: ComparisonRow[];
  vendorLevelExceptions: QuoteException[];
}

export interface ExtractionDetail {
  vendor: VendorSummary & { filePath: string; processingMs: number | null };
  quotes: Array<Quote & { lineItem: LineItem }>;
  exceptions: QuoteException[];
  questionnaire: Array<{
    id: string;
    questionId: number;
    questionText: string;
    answerText: string;
    passFail: boolean | null;
    confidence: number | null;
  }>;
}

export interface ExceptionCentre {
  summary: {
    total: number;
    byType: Array<{ type: string; count: number; severity: string }>;
    bySeverity: Array<{ severity: string; count: number }>;
    vendorsWithIncompleteResponses: Array<{ vendorId: string; vendorName: string; itemsMissing: number }>;
  };
  exceptions: QuoteException[];
}

export interface CopilotAnswer {
  question: string;
  /** True when the LLM stages were served from cache; the calculation is unchanged. */
  cached?: boolean;
  interpretation: string;
  analysisType: string;
  calculation: unknown;
  answer: string;
  caveats: string[];
  supported: boolean;
}

export interface AwardRecommendation {
  strategy: "split_award" | "single_vendor" | "manual_review_required";
  headline: string;
  allocations: Array<{ vendorId: string; vendorName: string; itemCount: number; lineItemIds: number[]; total: number }>;
  singleVendorOption: { vendorName: string; total: number } | null;
  totalEvaluatedCost: number | null;
  savings: number | null;
  savingsBaselineLabel: string | null;
  awardedItemCount: number;
  totalLineItems: number;
  qualityQualifiedVendorCount: number;
  provisional?: boolean;
  blockingVerifications?: Array<{ lineItemId: number; vendorName: string; reason: string }>;
  vendorsWithUnresolvedQuality: Array<{ vendorId: string; vendorName: string; reason: string }>;
  itemsRequiringReview: number;
  evidence: string[];
  excludedVendors: Array<{ vendorId: string; vendorName: string; reason: string }>;
  reviewBeforeAward: string[];
  confidenceNote: string;
}

export interface ImpactReport {
  metrics: Array<{ label: string; value: string; basis: "measured" | "target"; detail: string }>;
  generatedAt: string;
}

export interface AccuracyReport {
  overallPriceAccuracy: number | null;
  totalPricedFields: number;
  totalCorrect: number;
  omissionDetectionAccuracy: number | null;
  perVendor: Array<{
    vendorName: string;
    pricedFieldsExpected: number;
    pricedFieldsCorrect: number;
    priceAccuracy: number | null;
    omissionsExpected: number;
    omissionsCorrectlyDetected: number;
    falselyReportedMissing: number;
  }>;
  mismatches: Array<{
    vendorName: string;
    lineItemId: number;
    expected: number | null;
    extracted: number | null;
    correct: boolean;
    note: string | null;
  }>;
  basis: string;
}

export interface SupplierRecord {
  id: string;
  name: string;
  email: string;
  category: string;
  city: string | null;
  gstin: string | null;
  verificationStatus: string;
  verificationNote: string | null;
  paymentTerms: string | null;
  pastWork: string | null;
  onTimeDeliveryPct: number | null;
  qualityScore: number | null;
  historyCount: number;
  awardedCount: number;
  qualityIncidents: number;
  recordedAwardValue: number;
  history: Array<{
    externalId: string;
    title: string;
    category: string;
    completedAt: string;
    result: string;
    performance: string | null;
    qualityIncidents: number;
    awardValueInr: number | null;
  }>;
  currentInvitations: Array<{ rfxId: string; rfxName: string; status: string; respondedAt: string | null }>;
}

export interface ProcurementHistory {
  basis: string;
  recordedValue: number;
  recordedSavings: number;
  records: Array<{
    id: string;
    externalId: string;
    title: string;
    category: string;
    completedAt: string;
    awardedVendorName: string;
    awardedSupplierId: string | null;
    awardValueInr: number;
    baselineInr: number | null;
    savingsInr: number | null;
    savingsPct: number | null;
    source: string;
    participants: Array<{
      supplierId: string;
      name: string;
      result: string;
      performance: string | null;
      qualityIncidents: number;
    }>;
  }>;
}

export interface RfxDraft {
  name: string;
  category: string;
  description: string;
  suggestedRequiredByDays: number;
  currency: string;
  lineItems: Array<{ name: string; specification: string; quantity: number; unit: string }>;
  assumptions: string[];
}

// -------------------------------------------------------------- derivations

/** The shape of "why is this number what it is". Produced entirely by the
 * calculation engine — see services/api/src/calc/derivation.ts. No model output
 * reaches any field on this type. */
export interface DerivationTerm {
  role: "input" | "operator" | "result";
  label: string;
  value: number | null;
  valueText?: string;
  kind?: "currency" | "count";
  note?: string;
}

export interface DerivationColumn {
  key: string;
  label: string;
  align: "left" | "right";
  kind?: "currency" | "number" | "text";
}

export interface DerivationTable {
  caption: string;
  note?: string;
  columns: DerivationColumn[];
  rows: Array<Record<string, string | number | null>>;
  footer?: Record<string, string | number | null>;
}

export interface DerivationCheck {
  label: string;
  expected: number;
  actual: number;
  ok: boolean;
  method: string;
}

export interface Derivation {
  figure: string;
  title: string;
  value: number | null;
  valueKind: "currency" | "count";
  formula: string;
  rule: string;
  terms: DerivationTerm[];
  tables: DerivationTable[];
  inclusions: string[];
  exclusions: string[];
  checks: DerivationCheck[];
  provenance: string;
}

export interface PortfolioMetrics {
  savingsCaptured: number;
  awardedValue: number;
  activeValue: number;
  counts: { total: number; active: number; draft: number; awarded: number };
  eventsWithoutPricing: number;
}

export type PortfolioFigure = "portfolio_savings" | "portfolio_active_value" | "portfolio_awarded_value";

export type ExplainableFigure =
  | "savings"
  | "total_evaluated_cost"
  | "awarded_items"
  | "quality_qualified_vendors"
  | "vendor_total"
  | "allocation";

// ----------------------------------------------------------------- inbox

export interface InboxStatus {
  transport: "imap" | "sample";
  description: string;
  connected: boolean;
  inboxAddress: string | null;
}

export interface SyncSummary {
  transport: string;
  fetched: number;
  duplicates: number;
  matched: number;
  unmatched: number;
  attached: number;
  messages: Array<{ id: string; from: string; subject: string; matchedTo: string | null; reason: string }>;
}

export interface InvitedResponse {
  supplierId: string;
  name: string;
  email: string;
  invitedAt: string;
  status: string;
  respondedAt: string | null;
  responseSubject: string | null;
  snippet: string | null;
  attachments: string[];
  vendorId: string | null;
  vendorName: string | null;
  vendorStatus: string | null;
  responseFormat: string | null;
  itemsFound: number | null;
  itemsMissing: number | null;
  /** The document the supplier sent, openable so a reviewer can check it. */
  documentUrl: string | null;
  matchedBy: string | null;
}

export interface UninvitedResponse {
  id: string;
  from: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  snippet: string;
  attachments: string[];
  matchedBy: string | null;
  matchConfidence: string | null;
  vendorId: string | null;
  note: string | null;
}

export interface ResponseLedger {
  replyAddress: string | null;
  inboxConnected: boolean;
  transport: string;
  invited: InvitedResponse[];
  uninvited: UninvitedResponse[];
}

export interface UnmatchedMessage {
  id: string;
  from: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  snippet: string;
  attachments: string[];
  note: string | null;
}

// ------------------------------------------------------------------- calls

export const api = {
  listRfx: (scope?: "active") => get<Rfx[]>(`/rfx${scope ? `?scope=${scope}` : ""}`),
  listBuyers: () => get<Buyer[]>("/buyers"),
  findPriorProcurement: (q: string) =>
    get<SimilarPastProcurement[]>(`/procurement-precedent?q=${encodeURIComponent(q)}`),
  findSimilarRfx: (q: string) => get<SimilarRfx[]>(`/rfx-similar?q=${encodeURIComponent(q)}`),
  /**
   * Clarifying questions, plus the precedent that goes with them.
   *
   * The precedent search is deterministic and needs no model, so when the model
   * is unavailable the server still returns it. This call therefore reads the
   * body on a failure too, rather than throwing it away: "you have bought this
   * before, from them, at that price" is exactly the thing worth showing when
   * the drafting assistant is down, and it is the half that cannot fail.
   */
  clarifyRfx: async (description: string): Promise<ClarifyResult> => {
    const res = await fetch(`${BASE}/rfx/clarify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return body as ClarifyResult;
    const error = new Error(body.detail ?? body.error ?? `${res.status} ${res.statusText}`) as Error & {
      similar?: SimilarRfx[];
      priorProcurement?: SimilarPastProcurement[];
    };
    error.similar = body.similar ?? [];
    error.priorProcurement = body.priorProcurement ?? [];
    throw error;
  },
  createRfx: (payload: Record<string, unknown>) => post<Rfx>("/rfx", payload),
  getRfx: (id: string) => get<RfxDetail>(`/rfx/${id}`),
  getRfxFacets: () => get<RfxFacets>("/rfx-facets"),
  getEmailPreview: (rfxId: string) => get<ComposedEmail>(`/rfx/${rfxId}/email-preview`),
  getSupplierShortlist: (rfxId: string) => get<SupplierShortlist>(`/rfx/${rfxId}/suppliers`),
  getInvitations: (rfxId: string) => get<RfxInvitation[]>(`/rfx/${rfxId}/invitations`),
  issueRfx: (rfxId: string, payload: { supplierIds: string[]; newEmails: string[]; subject: string; body: string }) =>
    post<IssueResult>(`/rfx/${rfxId}/issue`, payload),
  updateRfx: (id: string, payload: Record<string, unknown>) => patch<Rfx>(`/rfx/${id}`, payload),
  deleteRfx: (id: string) => del<{ success: boolean; deletedId: string }>(`/rfx/${id}`),
  draftRfx: (description: string, itemCountHint?: number, answers?: Array<{ question: string; answer: string }>) =>
    post<RfxDraft>("/rfx/draft", { description, itemCountHint, answers }),
  listVendors: (rfxId: string) => get<VendorSummary[]>(`/rfx/${rfxId}/vendors`),
  addVendor: (rfxId: string, payload: { name: string; responseFormat: string; textContent?: string; fileBase64?: string }) =>
    post<VendorSummary>(`/rfx/${rfxId}/vendors`, payload),
  processVendor: (rfxId: string, vendorId: string) =>
    post<{ vendorName: string; status: string }>(`/rfx/${rfxId}/vendors/${vendorId}/process`, {}),
  updateQuote: (rfxId: string, vendorId: string, quoteId: string, payload: Record<string, unknown>) =>
    patch<Quote>(`/rfx/${rfxId}/vendors/${vendorId}/quotes/${quoteId}`, payload),
  deleteVendorResponse: (rfxId: string, vendorId: string) =>
    del<{ deleted: string; name: string }>(`/rfx/${rfxId}/vendors/${vendorId}`),
  getExtraction: (vendorId: string) => get<ExtractionDetail>(`/vendors/${vendorId}/extraction`),
  getComparison: (rfxId: string) => get<Comparison>(`/rfx/${rfxId}/comparison`),
  getExceptions: (rfxId: string, filters: Record<string, string> = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return get<ExceptionCentre>(`/rfx/${rfxId}/exceptions${qs ? `?${qs}` : ""}`);
  },
  askCopilot: (rfxId: string, question: string) => post<CopilotAnswer>(`/rfx/${rfxId}/copilot`, { question }),
  getAward: (rfxId: string) => get<AwardRecommendation>(`/rfx/${rfxId}/award`),
  getMetrics: (rfxId: string) => get<ImpactReport>(`/rfx/${rfxId}/metrics`),
  getAccuracy: (rfxId: string) => get<AccuracyReport>(`/rfx/${rfxId}/accuracy`),
  comparisonExportUrl: (rfxId: string) => `${BASE}/rfx/${rfxId}/export/comparison.xlsx`,
  awardMemoUrl: (rfxId: string) => `${BASE}/rfx/${rfxId}/export/award-memo.pdf`,
  getPortfolioMetrics: () => get<PortfolioMetrics>("/portfolio/metrics"),
  getInboxStatus: () => get<InboxStatus>("/inbox/status"),
  syncInbox: () => post<SyncSummary>("/inbox/sync", {}),
  getResponses: (rfxId: string) => get<ResponseLedger>(`/rfx/${rfxId}/responses`),
  getUnmatchedMail: () => get<UnmatchedMessage[]>("/inbox/unmatched"),
  assignInboundMessage: (messageId: string, rfxId: string, supplierId?: string) =>
    post<{ messageId: string; rfxId: string; vendorId: string | null }>(`/inbox/messages/${messageId}/assign`, {
      rfxId,
      supplierId,
    }),
  explainPortfolio: (figure: PortfolioFigure) => get<Derivation>(`/portfolio/explain/${figure}`),
  explainFigure: (rfxId: string, figure: ExplainableFigure, vendorId?: string) =>
    get<Derivation>(`/rfx/${rfxId}/explain/${figure}${vendorId ? `?vendorId=${encodeURIComponent(vendorId)}` : ""}`),
  listSuppliers: () => get<SupplierRecord[]>("/suppliers"),
  getProcurementHistory: () => get<ProcurementHistory>("/procurement-history"),
  listAllVendors: () =>
    get<Array<{ id: string; name: string; format: string; qualityScore: string; status: string; categories: string }>>("/vendors"),
  listApprovals: () =>
    get<Array<{ id: string; prx: string; buyer: string; value: string; vendor: string; status: string; date: string }>>("/approvals"),
};

// ------------------------------------------------------------- formatting

export function formatInr(value: number | null | undefined, opts: { decimals?: boolean } = {}): string {
  if (value == null) return "—";
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  })}`;
}

export function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
