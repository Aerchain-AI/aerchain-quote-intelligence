import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Icon from "../components/Icon";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, ErrorState, Spinner } from "../components/ui";
import { useGlobalChat } from "../lib/ChatContext";
import { getSession } from "../lib/auth";
import {
  api,
  type Buyer,
  type ClarifyQuestion,
  type ClarifyResult,
  type DraftLineItem,
  type RfxDraft,
  type SimilarRfx,
} from "../lib/api";

// ---------------------------------------------------------------- chat types

type ChatMessageType =
  | "user-request"
  | "ai-text"
  | "clarifying-spinner"
  | "drafting-spinner"
  | "error";

interface ChatMessage {
  id: string;
  role: "user" | "system";
  type: ChatMessageType;
  text?: string;
}

let _msgId = 0;
function nextMsgId(): string {
  return `msg-${++_msgId}-${Date.now()}`;
}

const DRAFT_STATE_KEY = "qic.rfx.inProgress";
type Stage = "idle" | "clarifying" | "items_draft" | "questions" | "drafting" | "draft";

// Canvas card types — rendered in the right pane
type CanvasCardType =
  | "extraction-summary"
  | "item-draft"
  | "similar-events"
  | "commercial-terms"
  | "draft-preview";

interface CanvasCard {
  id: string;
  type: CanvasCardType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any;
}

interface PersistedState {
  request: string;
  stage: Stage;
  clarify: ClarifyResult | null;
  confirmedItems: DraftLineItem[];
  answers: Record<string, string[]>;
  freeText: Record<string, string>;
  draft: RfxDraft | null;
  messages: ChatMessage[];
  canvasCards: CanvasCard[];
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed.stage === "clarifying" || parsed.stage === "drafting") {
      parsed.stage = parsed.clarify ? "questions" : "idle";
    }
    if (parsed.messages) {
      parsed.messages = parsed.messages.filter(
        (m) => m.type !== "clarifying-spinner" && m.type !== "drafting-spinner",
      );
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePersisted(state: PersistedState): void {
  try {
    sessionStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(state));
  } catch { /* no-op */ }
}

function clearPersisted(): void {
  try {
    sessionStorage.removeItem(DRAFT_STATE_KEY);
  } catch { /* no-op */ }
}

const CHECK_EL = <Icon name="check" size={13} />;

export default function RfxBuilderScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { registerWorkspaceHandler, setChatInput } = useGlobalChat();

  // Buyers
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [activeBuyerId, setActiveBuyerId] = useState<string>("");

  // Check for fresh & prompt query params
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isFresh = searchParams.get("fresh") === "true";
  const promptParam = searchParams.get("prompt");

  // Restored state
  const restored = useMemo(() => (isFresh ? null : loadPersisted()), [isFresh]);
  const [request, setRequest] = useState(restored?.request ?? "");
  const [stage, setStage] = useState<Stage>(restored?.stage ?? "idle");
  const [clarify, setClarify] = useState<ClarifyResult | null>(restored?.clarify ?? null);
  const [confirmedItems, setConfirmedItems] = useState<DraftLineItem[]>(restored?.confirmedItems ?? []);
  const [answers, setAnswers] = useState<Record<string, string[]>>(restored?.answers ?? {});
  const [freeText, setFreeText] = useState<Record<string, string>>(restored?.freeText ?? {});
  const [draft, setDraft] = useState<RfxDraft | null>(restored?.draft ?? null);
  const [stageError, setStageError] = useState<string | null>(null);

  // Chat messages (left pane)
  const [messages, setMessages] = useState<ChatMessage[]>(restored?.messages ?? []);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Canvas cards (right pane)
  const [canvasCards, setCanvasCards] = useState<CanvasCard[]>(restored?.canvasCards ?? []);

  // Track if auto-execute has been fired
  const autoExecutedRef = useRef(false);

  // Reset state if fresh query param is present
  useEffect(() => {
    if (isFresh) {
      clearPersisted();
      setRequest("");
      setStage("idle");
      setClarify(null);
      setConfirmedItems([]);
      setAnswers({});
      setFreeText({});
      setDraft(null);
      setMessages([]);
      setCanvasCards([]);
      autoExecutedRef.current = false;
      // Strip fresh param but keep prompt param
      if (promptParam) {
        navigate(`${location.pathname}?prompt=${encodeURIComponent(promptParam)}`, { replace: true });
      } else {
        navigate(location.pathname, { replace: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load buyers. The event must be attributed to whoever is signed in — falling
  // back to list[0] meant every event was stamped to whichever buyer sorted
  // first, regardless of who raised it.
  useEffect(() => {
    api.listBuyers()
      .then((list) => {
        setBuyers(list);
        const session = getSession();
        const me = session ? list.find((b) => b.id === session.id || b.email === session.email) : null;
        setActiveBuyerId((prev) => prev || me?.id || list[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

  // Persist state
  useEffect(() => {
    if (stage === "idle" && !clarify && !draft && !request.trim() && messages.length === 0) {
      clearPersisted();
      return;
    }
    savePersisted({ request, stage, clarify, confirmedItems, answers, freeText, draft, messages, canvasCards });
  }, [request, stage, clarify, confirmedItems, answers, freeText, draft, messages, canvasCards]);

  const activeBuyer = useMemo(
    () => buyers.find((b) => b.id === activeBuyerId) ?? null,
    [buyers, activeBuyerId],
  );

  const pushMessage = (msg: ChatMessage) => setMessages((prev) => [...prev, msg]);
  const pushCanvas = (card: CanvasCard) => setCanvasCards((prev) => [...prev, card]);

  // ---- core actions

  const startClarify = useCallback(async (submittedText: string) => {
    if (!submittedText.trim()) return;

    setRequest("");
    setStage("clarifying");
    setStageError(null);
    setClarify(null);
    setConfirmedItems([]);
    setDraft(null);
    setCanvasCards([]);

    // Push user message to chat
    pushMessage({
      id: nextMsgId(),
      role: "user",
      type: "user-request",
      text: submittedText,
    });

    // Push spinner to chat
    const spinnerId = nextMsgId();
    pushMessage({
      id: spinnerId,
      role: "system",
      type: "clarifying-spinner",
    });

    try {
      const result = await api.clarifyRfx(submittedText);
      setClarify(result);
      setStage("items_draft");

      // Replace spinner with AI conversational reply in left chat
      setMessages((prev) => {
        const withoutSpinner = prev.filter((m) => m.id !== spinnerId);
        return [
          ...withoutSpinner,
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "ai-text" as const,
            text: `I've detected this as a **${result.detectedCategory}** requirement. ${result.interpretation || ""}\n\nI've drafted ${result.itemsDraft?.length || 0} line items for you. Please review and confirm them in the canvas on the right →`,
          },
        ];
      });

      // Push canvas cards to right pane
      setCanvasCards([
        {
          id: nextMsgId(),
          type: "extraction-summary",
          payload: result,
        },
        {
          id: nextMsgId(),
          type: "item-draft",
          payload: {
            items: result.itemsDraft || [],
            category: result.detectedCategory,
            isConfirmed: false,
          },
        },
      ]);
    } catch (err) {
      setStageError((err as Error).message);
      setStage("idle");
      setMessages((prev) => {
        const withoutSpinner = prev.filter((m) => m.id !== spinnerId);
        return [
          ...withoutSpinner,
          { id: nextMsgId(), role: "system" as const, type: "error" as const, text: (err as Error).message },
        ];
      });
    }
  }, []);

  // Auto-execute when prompt param is present (intent-driven auto-routing)
  useEffect(() => {
    if (promptParam && !autoExecutedRef.current && stage === "idle" && messages.length === 0) {
      autoExecutedRef.current = true;
      // Remove prompt from URL
      navigate(location.pathname, { replace: true });
      startClarify(promptParam);
    }
  }, [promptParam, stage, messages.length, navigate, location.pathname, startClarify]);

  const handleConfirmItemList = async (items: DraftLineItem[]) => {
    setConfirmedItems(items);
    setStage("questions");

    // Fetch past events based on confirmed items & category
    const queryStr = [clarify?.detectedCategory, ...items.map((i) => i.name)].filter(Boolean).join(" ");
    let similarEvents: SimilarRfx[] = [];
    try {
      similarEvents = await api.findSimilarRfx(queryStr);
    } catch {
      similarEvents = clarify?.similar ?? [];
    }

    // AI confirmation in left chat
    pushMessage({
      id: nextMsgId(),
      role: "system",
      type: "ai-text",
      text: `✓ **${items.length} line items confirmed**. ${similarEvents.length > 0 ? `I found ${similarEvents.length} past event(s) that match.` : ""}\n\nNow let's settle the commercial & delivery terms to finalize your RFx.`,
    });

    // Update canvas cards
    setCanvasCards((prev) => {
      const updated = prev.map((card) => {
        if (card.type === "item-draft") {
          return { ...card, payload: { ...card.payload, items, isConfirmed: true } };
        }
        return card;
      });

      if (similarEvents.length > 0) {
        updated.push({
          id: nextMsgId(),
          type: "similar-events",
          payload: similarEvents,
        });
      }

      updated.push({
        id: nextMsgId(),
        type: "commercial-terms",
        payload: clarify,
      });

      return updated;
    });
  };

  const toggleAnswer = (q: ClarifyQuestion, value: string) => {
    setAnswers((prev) => {
      const current = prev[q.id] ?? [];
      if (q.multiSelect) {
        return { ...prev, [q.id]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] };
      }
      return { ...prev, [q.id]: [value] };
    });
  };

  const buildAnswers = () =>
    (clarify?.questions ?? []).map((q) => {
      const picked = (answers[q.id] ?? []).map((v) => q.options.find((o) => o.value === v)?.label ?? v).join(", ");
      const typed = freeText[q.id]?.trim();
      return { question: q.question, answer: [picked, typed].filter(Boolean).join(" — ") || "Not specified" };
    });

  const generateDraft = async () => {
    setStage("drafting");
    setStageError(null);

    const spinnerId = nextMsgId();
    pushMessage({ id: spinnerId, role: "system", type: "drafting-spinner" });

    try {
      const sourceText = messages.find((m) => m.type === "user-request")?.text ?? "";
      const result = await api.draftRfx(sourceText, confirmedItems.length, buildAnswers());

      if (confirmedItems.length > 0) {
        result.lineItems = confirmedItems;
      }

      setDraft(result);
      setStage("draft");

      setMessages((prev) => {
        const withoutSpinner = prev.filter((m) => m.id !== spinnerId);
        return [
          ...withoutSpinner,
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "ai-text" as const,
            text: `Your RFx **"${result.name}"** is ready for review.\n\n• **${result.lineItems.length}** line items\n• Currency: **${result.currency}**\n• Category: **${result.category}**\n\nReview the final proposal in the canvas and click **Confirm & Create** when you're satisfied.`,
          },
        ];
      });

      // Replace canvas with final draft preview
      setCanvasCards([
        {
          id: nextMsgId(),
          type: "draft-preview",
          payload: result,
        },
      ]);
    } catch (err) {
      setStageError((err as Error).message);
      setStage("questions");
      setMessages((prev) => {
        const withoutSpinner = prev.filter((m) => m.id !== spinnerId);
        return [
          ...withoutSpinner,
          { id: nextMsgId(), role: "system" as const, type: "error" as const, text: (err as Error).message },
        ];
      });
    }
  };

  const createRfx = async () => {
    if (!draft || !activeBuyerId) return;
    setStageError(null);
    const sourceRequest = messages.find((m) => m.type === "user-request")?.text ?? "";
    try {
      const requiredBy = new Date();
      requiredBy.setDate(requiredBy.getDate() + (draft.suggestedRequiredByDays || 30));
      const result = await api.createRfx({
        name: draft.name,
        category: draft.category,
        description: draft.description,
        currency: draft.currency,
        requiredByDate: requiredBy.toISOString(),
        lineItems: draft.lineItems,
        buyerId: activeBuyerId,
        sourceRequest,
        clarifications: buildAnswers(),
      });
      clearPersisted();
      navigate(`/events/${result.id}/overview`);
    } catch (err) {
      setStageError((err as Error).message);
    }
  };

  const reset = () => {
    setStage("idle");
    setClarify(null);
    setConfirmedItems([]);
    setDraft(null);
    setStageError(null);
    setAnswers({});
    setFreeText({});
    setRequest("");
    setMessages([]);
    setCanvasCards([]);
    clearPersisted();
  };

  // Register workspace command handler with ChatContext
  useEffect(() => {
    registerWorkspaceHandler((text: string) => {
      // If we're in the items_draft/questions stage, treat commands as text additions
      if (stage === "idle" || !clarify) {
        // Start a new clarification
        startClarify(text);
      } else {
        // Push user command to chat and provide AI response
        pushMessage({
          id: nextMsgId(),
          role: "user",
          type: "user-request",
          text,
        });
        pushMessage({
          id: nextMsgId(),
          role: "system",
          type: "ai-text",
          text: `Got it — I'll incorporate "${text}" into the current draft. You can continue editing in the canvas on the right.`,
        });
      }
    });

    return () => {
      registerWorkspaceHandler(null);
    };
  }, [registerWorkspaceHandler, stage, clarify, startClarify]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-screen" style={{ marginLeft: "-16rem" }}>
      {/* Header */}
      <header className="flex-none border-b border-[var(--line)] bg-[var(--surface)] z-10 pl-64">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/events"
              className="text-[12px] font-medium text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
            >
              <Icon name="arrow-left" size={13} /> Back to events
            </Link>
            <span className="text-[var(--ink-muted)]">|</span>
            <div className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-[var(--accent)] text-[10px] font-bold text-[var(--ink-inverse)]">
                AI
              </span>
              <span className="text-[13px] font-semibold text-[var(--ink)]">RFx Builder</span>
            </div>
            {stage !== "idle" && (
              <span className="ml-3 rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[10px] font-semibold text-[var(--ink)] uppercase tracking-wider">
                {stage === "clarifying" ? "Analyzing…" :
                 stage === "items_draft" ? "Item Review" :
                 stage === "questions" ? "Commercial Terms" :
                 stage === "drafting" ? "Generating…" :
                 stage === "draft" ? "Final Review" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">Raising as</span>
            <select
              value={activeBuyerId}
              onChange={(e) => setActiveBuyerId(e.target.value)}
              className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            >
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.team}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* ═══ Split-Screen Body ═══ */}
      <div className="flex flex-1 overflow-hidden pl-64">
        {/* ──── LEFT PANE: Chat Feed (35%) ──── */}
        <div className="w-[35%] flex flex-col border-r border-[var(--line)] bg-[var(--surface-sunken)]">
          <div className="flex-1 overflow-y-auto pb-28">
            {!hasMessages ? (
              /* Welcome state */
              <div className="flex flex-col items-center justify-center h-full px-6 py-12">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-soft)] mb-4">
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-[10px]"
                    style={{ background: "var(--surface-inverse)", color: "var(--ink-inverse)" }}
                  >
                    <Icon name="spark" size={15} />
                  </span>
                </div>
                <h3 className="text-[16px] font-semibold text-[var(--ink)] text-center">
                  AI RFx Builder
                </h3>
                <p className="mt-2 text-[12px] text-[var(--ink-muted)] text-center leading-relaxed max-w-[280px]">
                  Type your procurement requirement in the chat bar below. I'll extract the category, draft items, and build your RFx.
                </p>
                <div className="mt-6 space-y-2 w-full max-w-[280px]">
                  {[
                    "I need 10 construction materials",
                    "Source corrugated packaging boxes",
                    "Buy office furniture for 50 desks",
                  ].map((example) => (
                    <button
                      key={example}
                      onClick={() => {
                        setChatInput(example);
                      }}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-left text-[12px] text-[var(--ink-secondary)] transition-all hover:border-[var(--line-strong)] hover:bg-[var(--accent-soft)]/50 hover:text-[var(--ink)]"
                    >
                      <span className="flex items-center gap-2">
                        <Icon name="arrow-right" size={12} className="text-[var(--ink-muted)]" />
                        {example}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Chat message list */
              <div className="space-y-4 px-4 py-5">
                {messages.map((msg) => (
                  <ChatBubble key={msg.id} msg={msg} />
                ))}

                {stageError && (
                  <div className="pl-8">
                    <ErrorState message={stageError} />
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* ──── RIGHT PANE: Output Canvas (65%) ──── */}
        <div className="w-[65%] flex flex-col bg-[var(--surface)]">
          <div className="flex-1 overflow-y-auto pb-28">
            {canvasCards.length === 0 ? (
              /* Empty canvas state */
              <div className="flex flex-col items-center justify-center h-full px-8 py-12 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--surface-hover)] mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-[var(--ink-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18" />
                    <path d="M9 21V9" />
                  </svg>
                </div>
                <h3 className="text-[15px] font-semibold text-[var(--ink-secondary)]">Output Canvas</h3>
                <p className="mt-1.5 text-[12px] text-[var(--ink-muted)] max-w-[300px] leading-relaxed">
                  Your AI-generated extraction summary, item drafts, and RFx proposal will appear here.
                </p>
              </div>
            ) : (
              /* Canvas cards */
              <div className="space-y-5 px-6 py-5">
                {canvasCards.map((card) => (
                  <CanvasCardRenderer
                    key={card.id}
                    card={card}
                    answers={answers}
                    freeText={freeText}
                    toggleAnswer={toggleAnswer}
                    setFreeText={setFreeText}
                    onConfirmItemList={handleConfirmItemList}
                    generateDraft={generateDraft}
                    reset={reset}
                    draft={draft}
                    activeBuyer={activeBuyer}
                    activeBuyerId={activeBuyerId}
                    setActiveBuyerId={setActiveBuyerId}
                    buyers={buyers}
                    createRfx={createRfx}
                    stage={stage}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ Chat Bubble (left pane)

function ChatBubble({ msg }: { msg: ChatMessage }) {
  if (msg.type === "user-request") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)] px-4 py-3 text-[13px] leading-relaxed text-[var(--ink-inverse)] shadow-sm">
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.type === "clarifying-spinner") {
    return (
      <div className="flex gap-2.5">
        <div className="flex-none">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--ink)]">
            AI
          </span>
        </div>
        <div className="flex-1">
          <Spinner label="Analyzing requirement and drafting items…" />
        </div>
      </div>
    );
  }

  if (msg.type === "drafting-spinner") {
    return (
      <div className="flex gap-2.5">
        <div className="flex-none">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--ink)]">
            AI
          </span>
        </div>
        <div className="flex-1">
          <Spinner label="Generating your complete RFx draft…" />
        </div>
      </div>
    );
  }

  if (msg.type === "error") {
    return (
      <div className="flex gap-2.5">
        <div className="flex-none">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--critical-soft)] text-[10px] font-bold text-[var(--critical)]">
            !
          </span>
        </div>
        <div className="flex-1">
          <div className="rounded-xl bg-[var(--critical-soft)] border border-[var(--critical-line)] px-4 py-3 text-[12px] text-[var(--critical)]">
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  // ai-text
  return (
    <div className="flex gap-2.5">
      <div className="flex-none">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[10px] font-bold text-[var(--ink)]">
          AI
        </span>
      </div>
      <div className="flex-1">
        <div className="rounded-2xl rounded-bl-sm bg-[var(--surface)] border border-[var(--line)] px-4 py-3 text-[13px] leading-relaxed text-[var(--ink)] shadow-sm">
          {msg.text?.split("\n").map((line, i) => (
            <p key={i} className={i > 0 ? "mt-1.5" : ""}>
              {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                part.startsWith("**") && part.endsWith("**") ? (
                  <strong key={j} className="font-semibold text-[var(--ink)]">
                    {part.slice(2, -2)}
                  </strong>
                ) : (
                  <span key={j}>{part}</span>
                )
              )}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================ Canvas Card Renderer (right pane)

interface CanvasRenderContext {
  card: CanvasCard;
  navigate: ReturnType<typeof useNavigate>;
  answers: Record<string, string[]>;
  freeText: Record<string, string>;
  toggleAnswer: (q: ClarifyQuestion, value: string) => void;
  setFreeText: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onConfirmItemList: (items: DraftLineItem[]) => void;
  generateDraft: () => void;
  reset: () => void;
  draft: RfxDraft | null;
  activeBuyer: Buyer | null;
  activeBuyerId: string;
  setActiveBuyerId: React.Dispatch<React.SetStateAction<string>>;
  buyers: Buyer[];
  createRfx: () => void;
  stage: Stage;
}

function CanvasCardRenderer(ctx: CanvasRenderContext) {
  const { card } = ctx;
  switch (card.type) {
    case "extraction-summary":
      return <ExtractionSummaryCanvas key={card.id} result={card.payload as ClarifyResult} />;
    case "item-draft":
      return (
        <InteractiveItemDraftCanvas
          key={card.id}
          initialItems={card.payload.items}
          category={card.payload.category}
          isConfirmed={card.payload.isConfirmed}
          onConfirm={ctx.onConfirmItemList}
        />
      );
    case "similar-events":
      return <SimilarEventsCanvas key={card.id} similar={card.payload as SimilarRfx[]} navigate={ctx.navigate} />;
    case "commercial-terms":
      return (
        <CommercialTermsCanvas
          key={card.id}
          result={card.payload as ClarifyResult}
          answers={ctx.answers}
          freeText={ctx.freeText}
          toggleAnswer={ctx.toggleAnswer}
          setFreeText={ctx.setFreeText}
          onDraft={ctx.generateDraft}
          onCancel={ctx.reset}
          stage={ctx.stage}
        />
      );
    case "draft-preview":
      return (
        <DraftPreviewCanvas
          key={card.id}
          draft={card.payload as RfxDraft}
          activeBuyer={ctx.activeBuyer}
          activeBuyerId={ctx.activeBuyerId}
          setActiveBuyerId={ctx.setActiveBuyerId}
          buyers={ctx.buyers}
          onConfirm={ctx.createRfx}
          onDiscard={ctx.reset}
        />
      );
    default:
      return null;
  }
}

// ============================================================ Canvas Components

// Extraction Summary Card
function ExtractionSummaryCanvas({ result }: { result: ClarifyResult }) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--accent)] text-[9px] font-bold text-[var(--ink-inverse)]">1</span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--ink)]">Requirement Extraction</p>
            <p className="text-[11px] text-[var(--ink-muted)]">AI-detected category & known facts</p>
          </div>
        </div>
        <span className="rounded-full bg-[var(--warning-soft)] px-2.5 py-1 text-[10px] font-semibold text-[var(--warning)] border border-[var(--warning-line)]">
          <Icon name="alert" size={13} /> Specification gap — blocking
        </span>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-[12px] font-medium text-[var(--ink-muted)]">Category:</span>
          <span className="rounded-md bg-[var(--accent-soft)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--ink)]">{result.detectedCategory}</span>
        </div>
        {result.interpretation && (
          <p className="text-[12px] text-[var(--ink-secondary)] leading-relaxed">{result.interpretation}</p>
        )}
        <div>
          <p className="text-[11px] font-semibold text-[var(--ink-muted)] uppercase tracking-wider mb-2">Stated Facts</p>
          <div className="flex flex-wrap gap-2">
            {result.alreadyKnown.map((k, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-[var(--good-soft)] px-2.5 py-1 text-[11px] text-[var(--good)] border border-[var(--good-line)]">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Interactive Item Draft Table Card
function InteractiveItemDraftCanvas({
  initialItems,
  category,
  isConfirmed,
  onConfirm,
}: {
  initialItems: DraftLineItem[];
  category: string;
  isConfirmed?: boolean;
  onConfirm: (items: DraftLineItem[]) => void;
}) {
  const [items, setItems] = useState<DraftLineItem[]>(initialItems);
  const [isEditing, setIsEditing] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateItem = (index: number, field: keyof DraftLineItem, value: any) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: field === "quantity" ? Number(value) || 0 : value };
      return next;
    });
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { name: "New Line Item", specification: "Standard Spec", quantity: 100, unit: "pcs" },
    ]);
  };

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--accent)] text-[9px] font-bold text-[var(--ink-inverse)]">2</span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--ink)]">
              Item Specifications — {category}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
              {isConfirmed
                ? "Line items verified and confirmed"
                : `${items.length} AI-drafted items. Review, edit, then confirm.`}
            </p>
          </div>
        </div>
        {!isConfirmed && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink)] hover:bg-[var(--accent-soft)] transition-colors"
          >
            {isEditing ? "Done" : "Edit Items"}
          </button>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="bg-[var(--surface-sunken)] sticky top-0 border-b border-[var(--line)] text-[var(--ink-muted)] font-semibold uppercase tracking-wider text-[10px]">
            <tr>
              <th className="px-4 py-2.5 w-10">#</th>
              <th className="px-4 py-2.5">Item Name</th>
              <th className="px-4 py-2.5">Specification</th>
              <th className="px-4 py-2.5 text-right w-24">Qty</th>
              <th className="px-4 py-2.5 w-20">Unit</th>
              {isEditing && <th className="w-16 px-4 py-2.5 text-center"><span className="sr-only">Row actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {items.map((item, idx) => (
              <tr key={idx} className="hover:bg-[var(--accent-soft)]/30 transition-colors">
                <td className="px-4 py-2.5 font-mono text-[var(--ink-muted)] text-[11px]">{idx + 1}</td>
                <td className="px-4 py-2.5 font-medium text-[var(--ink)]">
                  {isEditing ? (
                    <input
                      type="text"
                      value={item.name}
                      onChange={(e) => updateItem(idx, "name", e.target.value)}
                      className="w-full rounded border border-[var(--line-strong)] px-2 py-1 text-[12px] outline-none focus:border-[var(--ink)]"
                    />
                  ) : (
                    item.name
                  )}
                </td>
                <td className="px-4 py-2.5 text-[var(--ink-secondary)]">
                  {isEditing ? (
                    <input
                      type="text"
                      value={item.specification}
                      onChange={(e) => updateItem(idx, "specification", e.target.value)}
                      className="w-full rounded border border-[var(--line-strong)] px-2 py-1 text-[12px] outline-none focus:border-[var(--ink)]"
                    />
                  ) : (
                    item.specification
                  )}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-[var(--ink)]">
                  {isEditing ? (
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(idx, "quantity", e.target.value)}
                      className="w-20 rounded border border-[var(--line-strong)] px-2 py-1 text-right text-[12px] outline-none focus:border-[var(--ink)]"
                    />
                  ) : (
                    item.quantity.toLocaleString("en-IN")
                  )}
                </td>
                <td className="px-4 py-2.5 text-[var(--ink-muted)]">
                  {isEditing ? (
                    <input
                      type="text"
                      value={item.unit}
                      onChange={(e) => updateItem(idx, "unit", e.target.value)}
                      className="w-16 rounded border border-[var(--line-strong)] px-2 py-1 text-[12px] outline-none focus:border-[var(--ink)]"
                    />
                  ) : (
                    item.unit
                  )}
                </td>
                {isEditing && (
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => removeItem(idx)}
                      className="text-[var(--critical)] hover:text-[var(--critical)] transition-colors"
                      title="Remove item"
                    >
                      <Icon name="close" size={14} title="Close" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
        {isEditing ? (
          <button
            onClick={addItem}
            className="text-[12px] font-semibold text-[var(--ink)] hover:underline"
          >
            + Add Line Item
          </button>
        ) : (
          <span className="text-[11px] text-[var(--ink-muted)]">
            {isConfirmed ? <>{CHECK_EL} Confirmed</> : "Confirm to unlock commercial terms"}
          </span>
        )}

        {!isConfirmed && (
          <Button
            onClick={() => onConfirm(items)}
            className="!bg-[var(--accent)] hover:!bg-[var(--accent-hover)] !px-5 inline-flex items-center gap-1.5"
          >
            Confirm Item List <Icon name="arrow-right" size={12} />
          </Button>
        )}
      </div>
    </div>
  );
}

// Similar Events Card
function SimilarEventsCanvas({
  similar,
  navigate,
}: {
  similar: SimilarRfx[];
  navigate: ReturnType<typeof useNavigate>;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] bg-[var(--warning-soft)] px-5 py-3">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg"
          style={{ background: "var(--warning)", color: "var(--ink-inverse)" }}
        >
          <Icon name="refresh" size={13} />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-[var(--ink)]">Historical Precedent Match</p>
          <p className="text-[11px] text-[var(--ink-muted)]">Past events matching confirmed items</p>
        </div>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {similar.map((s) => (
          <button
            key={s.id}
            onClick={() => navigate(`/events/${s.id}/overview`)}
            className="block w-full px-5 py-3 text-left transition-colors hover:bg-[var(--accent-soft)]/40"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[var(--ink)]">{s.name}</span>
              <span className="rounded-full bg-[var(--good-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--good)] border border-[var(--good-line)] uppercase">
                {s.status}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
              {s.category} · {s.lineItemCount} items · {s.buyerName ?? "unattributed"}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

// Commercial Terms Card
function CommercialTermsCanvas({
  result,
  answers,
  freeText,
  toggleAnswer,
  setFreeText,
  onDraft,
  onCancel,
  stage,
}: {
  result: ClarifyResult;
  answers: Record<string, string[]>;
  freeText: Record<string, string>;
  toggleAnswer: (q: ClarifyQuestion, value: string) => void;
  setFreeText: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onDraft: () => void;
  onCancel: () => void;
  stage: Stage;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--info-soft)] px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--accent)] text-[9px] font-bold text-[var(--ink-inverse)]">3</span>
          <div>
            <p className="text-[13px] font-semibold text-[var(--ink)]">Commercial & Delivery Terms</p>
            <p className="text-[11px] text-[var(--ink-muted)]">Items locked. Finalize commercial terms.</p>
          </div>
        </div>
        <button
          onClick={onCancel}
          className="text-[12px] text-[var(--ink-muted)] transition-colors hover:text-[var(--ink-secondary)]"
        >
          Cancel
        </button>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {result.questions.map((q, qi) => {
          const selected = answers[q.id] ?? [];
          return (
            <div key={q.id} className="px-5 py-4">
              <div className="flex items-start gap-2.5">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[var(--info-soft)] text-[11px] font-bold text-[var(--info)] mt-0.5">
                  {qi + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-[var(--ink)]">{q.question}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">{q.why}</p>

                  <div className="mt-3 space-y-1.5">
                    {q.options.map((o) => {
                      const isSelected = selected.includes(o.value);
                      return (
                        <button
                          key={o.value}
                          onClick={() => toggleAnswer(q, o.value)}
                          className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left text-[12px] transition-all ${
                            isSelected
                              ? "border-[var(--ink)] bg-[var(--accent-soft)] font-medium text-[var(--ink)]"
                              : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-sunken)]"
                          }`}
                        >
                          <span className="mt-0.5 flex-none">
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                                isSelected ? "border-[var(--ink)]" : "border-[var(--line-strong)]"
                              }`}
                            >
                              {isSelected && <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />}
                            </span>
                          </span>
                          <div>
                            <span className="font-semibold">{o.label}</span>
                            {o.description && (
                              <span className="ml-1.5 text-[var(--ink-muted)]">{o.description}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {q.allowFreeText && (
                    <input
                      value={freeText[q.id] ?? ""}
                      onChange={(e) =>
                        setFreeText((prev) => ({ ...prev, [q.id]: e.target.value }))
                      }
                      placeholder="Or type custom commercial term…"
                      className="mt-2 w-full rounded-lg border border-[var(--line)] px-3 py-2 text-[12px] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--ink)]"
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
        <span className="text-[11px] text-[var(--ink-muted)]">
          Commercial choices drive comparison engine normalization.
        </span>
        <Button
          onClick={onDraft}
          disabled={stage === "drafting"}
          className="!bg-[var(--accent)] hover:!bg-[var(--accent-hover)] !px-5"
        >
          {stage === "drafting" ? "Drafting…" : "Draft Final RFx"}
        </Button>
      </div>
    </div>
  );
}

// Final Draft Preview Card
function DraftPreviewCanvas({
  draft,
  activeBuyer,
  activeBuyerId,
  setActiveBuyerId,
  buyers,
  onConfirm,
  onDiscard,
}: {
  draft: RfxDraft;
  activeBuyer: Buyer | null;
  activeBuyerId: string;
  setActiveBuyerId: React.Dispatch<React.SetStateAction<string>>;
  buyers: Buyer[];
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--good-line)] bg-[var(--surface)] shadow-sm overflow-hidden">
      <div className="flex items-start justify-between border-b border-[var(--good-line)] bg-[var(--good-soft)] px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg"
            style={{ background: "var(--good)", color: "var(--ink-inverse)" }}
          >
            <Icon name="check" size={13} />
          </span>
          <div>
            <p className="text-[14px] font-bold text-[var(--ink)]">{draft.name}</p>
            <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
              {draft.category} · {draft.currency} · {draft.lineItems.length} items
            </p>
          </div>
        </div>
        <button
          onClick={onDiscard}
          className="text-[12px] text-[var(--ink-muted)] transition-colors hover:text-[var(--critical)]"
        >
          Discard
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <p className="text-[13px] leading-relaxed text-[var(--ink-secondary)]">{draft.description}</p>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)] mb-2">
            Confirmed Line Items ({draft.lineItems.length})
          </p>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[var(--surface-sunken)] sticky top-0 border-b border-[var(--line)] font-semibold text-[var(--ink-muted)] uppercase text-[10px]">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Specification</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Unit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {draft.lineItems.map((li, i) => (
                  <tr key={i} className="hover:bg-[var(--surface-sunken)]">
                    <td className="px-3 py-2 font-medium text-[var(--ink)]">{li.name}</td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{li.specification}</td>
                    <td className="px-3 py-2 text-right font-medium text-[var(--ink-secondary)]">
                      {li.quantity.toLocaleString("en-IN")}
                    </td>
                    <td className="px-3 py-2 text-[var(--ink-muted)]">{li.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--good-line)] bg-[var(--good-soft)] px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] text-[var(--ink-muted)]">
            <span>Raising as</span>
            <select
              value={activeBuyerId}
              onChange={(e) => setActiveBuyerId(e.target.value)}
              className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            >
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — {b.team}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={onConfirm}
            disabled={!activeBuyerId}
            className="!bg-[var(--good)] hover:!bg-[var(--good)] !px-6"
          >
            <Icon name="check" size={14} /> Confirm and create RFx
          </Button>
        </div>
      </div>
    </div>
  );
}
