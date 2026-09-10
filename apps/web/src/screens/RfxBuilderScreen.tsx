import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Icon from "../components/Icon";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, ErrorState, Spinner } from "../components/ui";
import { ChatComposer, PaneResizer, usePaneWidth } from "../components/ChatComposer";
import { useGlobalChat } from "../lib/ChatContext";
import { getSession } from "../lib/auth";
import {
  api,
  formatInr,
  type Buyer,
  type ClarifyQuestion,
  type ClarifyResult,
  type DraftLineItem,
  type RfxDraft,
  type SimilarPastProcurement,
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
  | "prior-procurement"
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
  /** Statements the buyer typed into the chat, kept verbatim. */
  buyerNotes: string[];
  /** Terms the buyer rewrote by hand in the preview, keyed by term. */
  termOverrides: Record<string, string>;
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

/** A condition of the quote, with the handle the preview edits it by. */
interface SettledTerm {
  key: string;
  question: string;
  answer: string;
}

const CHECK_EL = <Icon name="check" size={13} />;

export default function RfxBuilderScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { registerWorkspaceHandler, setChatInput } = useGlobalChat();

  // The conversation column is the reader's to size, the same way the copilot
  // rail is. A long clarification thread and a ten-column item table want very
  // different splits, and neither is right for everyone.
  const pane = usePaneWidth({
    key: "aerchain.builderPaneWidth",
    cssVar: "--builder-pane",
    initial: 460,
    min: 320,
    max: 760,
    reserve: 240 + 480,
  });

  // Buyers
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [activeBuyerId, setActiveBuyerId] = useState<string>("");

  const DEFAULT_BUYER: Buyer = useMemo(
    () => ({
      id: "buyer-prem",
      name: "Prem Kumar",
      email: "prem.kumar@aerchain.example",
      team: "Packaging Sourcing",
    }),
    []
  );

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

  // Everything the buyer said in the chat that is not one of the structured
  // questions. "It should be from Mumbai" used to be swallowed: the screen
  // recognised the currency in the same sentence, acted on it, and dropped the
  // rest. A requirement this screen cannot parse is still a requirement, so it
  // is kept word for word and carried into the summary and the invitation.
  const [buyerNotes, setBuyerNotes] = useState<string[]>(restored?.buyerNotes ?? []);

  // A term the buyer corrected by hand in the preview wins over the answer that
  // produced it. Emptying one removes it rather than sending a blank condition.
  const [termOverrides, setTermOverrides] = useState<Record<string, string>>(
    restored?.termOverrides ?? {},
  );
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
      setBuyerNotes([]);
      setTermOverrides({});
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

  // Load buyers.
  useEffect(() => {
    api.listBuyers()
      .then((list) => {
        const validList = list && list.length > 0 ? list : [DEFAULT_BUYER];
        setBuyers(validList);
        const session = getSession();
        const me = session ? validList.find((b) => b.id === session.id || b.email === session.email) : null;
        setActiveBuyerId((prev) => prev || me?.id || validList[0]?.id || DEFAULT_BUYER.id);
      })
      .catch(() => {
        setBuyers([DEFAULT_BUYER]);
        setActiveBuyerId((prev) => prev || DEFAULT_BUYER.id);
      });
  }, [DEFAULT_BUYER]);

  // Persist state
  useEffect(() => {
    if (stage === "idle" && !clarify && !draft && !request.trim() && messages.length === 0) {
      clearPersisted();
      return;
    }
    savePersisted({ request, stage, clarify, confirmedItems, answers, freeText, draft, messages, canvasCards, buyerNotes, termOverrides });
  }, [request, stage, clarify, confirmedItems, answers, freeText, draft, messages, canvasCards, buyerNotes, termOverrides]);

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
      // The drafting assistant failed, but the precedent search did not — it is
      // deterministic and never calls a model. Showing it here means a buyer
      // still learns they have bought this before, from whom and at what price,
      // on the day the model is unavailable.
      const carried = err as Error & { priorProcurement?: SimilarPastProcurement[] };
      const prior = carried.priorProcurement ?? [];
      if (prior.length > 0) {
        setCanvasCards((prev) => [
          ...prev,
          { id: nextMsgId(), type: "prior-procurement", payload: prior },
        ]);
      }

      setStageError((err as Error).message);
      setStage("idle");
      setMessages((prev) => {
        const withoutSpinner = prev.filter((m) => m.id !== spinnerId);
        return [
          ...withoutSpinner,
          { id: nextMsgId(), role: "system" as const, type: "error" as const, text: (err as Error).message },
          ...(prior.length > 0
            ? [
                {
                  id: nextMsgId(),
                  role: "system" as const,
                  type: "ai-text" as const,
                  text: `Drafting is unavailable, but I can still tell you this has been bought before — ${prior.length} closed procurement(s) match. They are on the canvas.`,
                },
              ]
            : []),
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
    // Closed procurement matching the request. Fetched alongside the similar
    // events because it answers a different question: not "can I copy this" but
    // "what did this cost last time, and who won it".
    const priorProcurement = await api.findPriorProcurement(queryStr).catch(() => []);

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

      if (priorProcurement.length > 0) {
        updated.push({
          id: nextMsgId(),
          type: "prior-procurement",
          payload: priorProcurement,
        });
      }

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

  /**
   * Every term the buyer has settled, in one list.
   *
   * The answers to the structured questions and the sentences typed into the
   * chat are the same kind of thing to a supplier — conditions of the quote —
   * so they travel together. "Not specified" is dropped rather than padded into
   * the invitation, which would read as a requirement when it is an absence.
   */
  const settledTerms = useCallback(
    (): SettledTerm[] =>
      [
        ...buildAnswers(),
        ...buyerNotes.map((note) => ({ question: "Stated by you", answer: note })),
      ]
        .map((t, i) => {
          const key = `${i}:${t.question}`;
          return { key, question: t.question, answer: termOverrides[key] ?? t.answer };
        })
        .filter(
          (t) => t.answer && t.answer.trim() && t.answer.trim().toLowerCase() !== "not specified",
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answers, freeText, clarify, buyerNotes, termOverrides],
  );

  /**
   * A hand edit in the preview, applied to the draft and to the card showing it.
   *
   * Both are updated together because the card holds its own copy of the payload;
   * changing one and not the other is how a preview starts telling a different
   * story from what gets created.
   */
  const applyDraftEdit = useCallback((next: RfxDraft) => {
    setDraft(next);
    setCanvasCards((prev) =>
      prev.map((card) => (card.type === "draft-preview" ? { ...card, payload: next } : card)),
    );
  }, []);

  const applyTermEdit = useCallback((key: string, answer: string) => {
    setTermOverrides((prev) => ({ ...prev, [key]: answer }));
  }, []);

  /** The same terms, shaped for the API — the edit key is a screen concern. */
  const termsForApi = useCallback(
    () => settledTerms().map(({ question, answer }) => ({ question, answer })),
    [settledTerms],
  );

  const generateDraft = async () => {
    setStage("drafting");
    setStageError(null);

    const spinnerId = nextMsgId();
    pushMessage({ id: spinnerId, role: "system", type: "drafting-spinner" });

    try {
      const sourceText = messages.find((m) => m.type === "user-request")?.text ?? "";
      const result = await api.draftRfx(sourceText, confirmedItems.length, termsForApi());

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
        clarifications: termsForApi(),
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
    setBuyerNotes([]);
    setTermOverrides({});
    clearPersisted();
  };

  /**
   * Rebuild the proposal around something the buyer changed after it was drafted.
   *
   * This screen used to answer a post-draft message with a regular expression:
   * it looked for a currency and, finding none, filed the sentence as a note. No
   * model was involved, which is why "change Mumbai to Hyderabad" came back
   * quoted rather than applied — the name, the scope and the assumptions were
   * still the ones written before the buyer said it. A refinement now goes back
   * through the drafting model with every settled term attached, so the
   * proposal is rewritten around it.
   *
   * Two things are held fixed across the rewrite. The line items the buyer
   * already confirmed are not re-invented, and a currency stated in plain words
   * is applied here rather than left to the model, because it is exact and a
   * quote in the wrong currency is not a small error.
   */
  const redraftWith = useCallback(
    async (note: string, currencyOverride: string | null) => {
      const sourceText = messages.find((m) => m.type === "user-request")?.text ?? request;
      const notes = buyerNotes.includes(note) ? buyerNotes : [...buyerNotes, note];
      const terms = [
        ...buildAnswers().filter(
          (t) => t.answer && t.answer.trim() && t.answer.trim().toLowerCase() !== "not specified",
        ),
        ...notes.map((n) => ({ question: "Stated by you", answer: n })),
      ];

      const spinnerId = nextMsgId();
      pushMessage({ id: spinnerId, role: "system", type: "drafting-spinner" });

      try {
        const result = await api.draftRfx(sourceText, confirmedItems.length, terms);
        if (confirmedItems.length > 0) result.lineItems = confirmedItems;
        const settledCurrency = currencyOverride ?? draft?.currency;
        if (settledCurrency) result.currency = settledCurrency;

        setDraft(result);
        setCanvasCards([{ id: nextMsgId(), type: "draft-preview", payload: result }]);
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== spinnerId),
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "ai-text" as const,
            text: `✓ Reworked the proposal around that.\n\n• **${result.name}**\n• Currency: **${result.currency}**\n• **${result.lineItems.length}** line items, unchanged\n\nCheck the requirement summary on the right — anything I inferred rather than being told is listed under "Filled in for you".`,
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== spinnerId),
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "error" as const,
            text: `${(err as Error).message}\n\nYour requirement is still recorded and will go to suppliers, but the proposal text was not rewritten.`,
          },
        ]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, request, buyerNotes, confirmedItems, draft, answers, freeText, clarify],
  );

  /**
   * Redraw the item list around something the buyer just said.
   *
   * Before the proposal exists there is still a draft on screen: the item list
   * waiting to be confirmed. Typing "I need 30 line items" against a list of 5
   * used to file the sentence as a note and leave all 5 sitting there, which
   * reads as an assistant taking dictation rather than doing the work. The
   * request goes back to the same drafting step that produced the list, with
   * everything the buyer has said so far attached, and the canvas is replaced
   * with what comes back.
   */
  const refineItems = useCallback(
    async (note: string) => {
      const original = messages.find((m) => m.type === "user-request")?.text ?? request;
      const notes = buyerNotes.includes(note) ? buyerNotes : [...buyerNotes, note];
      const combined = [original, ...notes.map((n) => `Additionally: ${n}`)].filter(Boolean).join("\n\n");

      const spinnerId = nextMsgId();
      pushMessage({ id: spinnerId, role: "system", type: "clarifying-spinner" });

      try {
        const result = await api.clarifyRfx(combined);
        const items = result.itemsDraft ?? [];

        setClarify(result);
        // The list changed, so any earlier confirmation of it no longer applies.
        setConfirmedItems([]);
        setStage("items_draft");

        setCanvasCards((prev) => {
          const next = prev.map((card) => {
            if (card.type === "extraction-summary") return { ...card, payload: result };
            if (card.type === "item-draft") {
              // A fresh id, not just a fresh payload. The item table seeds its
              // editable state from its props once, on mount, so that a buyer
              // editing a cell does not have it overwritten underneath them.
              // Replacing the whole list is the one case where that is exactly
              // what should happen, and a new key is how React is told so.
              return {
                ...card,
                id: nextMsgId(),
                payload: { items, category: result.detectedCategory, isConfirmed: false },
              };
            }
            return card;
          });
          // Anything that followed the item list was built on the old one.
          return next.filter(
            (c) => c.type === "extraction-summary" || c.type === "item-draft" || c.type === "prior-procurement",
          );
        });

        setMessages((prev) => [
          ...prev.filter((m) => m.id !== spinnerId),
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "ai-text" as const,
            text: `✓ Redrafted the item list around that — **${items.length} line item(s)** now on the canvas.\n\nReview them and confirm when they look right.`,
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== spinnerId),
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "error" as const,
            text: `${(err as Error).message}\n\nThe item list is unchanged, and your requirement is recorded either way.`,
          },
        ]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, request, buyerNotes],
  );

  /**
   * Copy a past event's line items into the draft being written.
   *
   * The precedent card used to be a link. Clicking the one thing on screen that
   * says "you have bought this before" navigated away to that event, discarded
   * the draft in progress, and offered no way to use what it had just found.
   * The buyer was shown the answer and then walked away from their own work.
   *
   * Reuse happens here instead, on this screen. The items land in the same
   * editable table every other draft lands in, unconfirmed, so they are read
   * and corrected before anything is created. Nothing is committed by copying.
   */
  const reuseItemsFrom = useCallback(
    async (source: SimilarRfx) => {
      const spinnerId = nextMsgId();
      pushMessage({ id: spinnerId, role: "system", type: "clarifying-spinner" });

      try {
        const detail = await api.getRfx(source.id);
        const items: DraftLineItem[] = (detail.lineItems ?? []).map((li) => ({
          name: li.name,
          specification: li.specification,
          quantity: li.quantity,
          unit: li.unit,
        }));

        if (items.length === 0) {
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== spinnerId),
            {
              id: nextMsgId(),
              role: "system" as const,
              type: "ai-text" as const,
              text: `**${source.name}** holds no line items, so there is nothing to copy. Your draft is unchanged.`,
            },
          ]);
          return;
        }

        setConfirmedItems([]);
        setStage("items_draft");
        setCanvasCards((prev) =>
          prev
            .map((card) =>
              card.type === "item-draft"
                ? {
                    ...card,
                    // New key: the table seeds its rows once, on mount.
                    id: nextMsgId(),
                    payload: {
                      items,
                      category: source.category,
                      isConfirmed: false,
                      sourceLabel: `Copied from ${source.name}`,
                    },
                  }
                : card,
            )
            // The commercial terms and any proposal were settled against the
            // list that has just been replaced, so they no longer describe
            // anything on this canvas. The precedent cards stay: the buyer may
            // want to copy from a different one.
            .filter((c) => c.type !== "commercial-terms" && c.type !== "draft-preview"),
        );
        setDraft(null);

        setMessages((prev) => [
          ...prev.filter((m) => m.id !== spinnerId),
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "ai-text" as const,
            text:
              `✓ Copied **${items.length} line item(s)** from **${source.name}** into your draft.\n\n` +
              `Nothing is created yet. Change quantities, specifications or units on the canvas, ` +
              `then confirm the list →`,
          },
        ]);
      } catch (err) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== spinnerId),
          {
            id: nextMsgId(),
            role: "system" as const,
            type: "error" as const,
            text: `${(err as Error).message}\n\nYour draft is unchanged.`,
          },
        ]);
      }
    },
    [],
  );

  const handleUserMutation = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      pushMessage({
        id: nextMsgId(),
        role: "user",
        type: "user-request",
        text: trimmed,
      });

      // Recorded before anything is interpreted, so a sentence carrying two
      // requirements cannot lose the one this screen has no rule for.
      setBuyerNotes((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));

      const lower = trimmed.toLowerCase();

      // A currency named in plain words is exact, so it is read here rather than
      // inferred. Everything else in the sentence still goes to the model below.
      let detectedCurrency: string | null = null;
      if (/\b(inr|rupees|₹)\b/i.test(lower)) detectedCurrency = "INR";
      else if (/\b(usd|dollars|\$)\b/i.test(lower)) detectedCurrency = "USD";
      else if (/\b(eur|euros|€)\b/i.test(lower)) detectedCurrency = "EUR";
      else if (/\b(gbp|pounds|£)\b/i.test(lower)) detectedCurrency = "GBP";
      else if (/\b(jpy|yen|¥)\b/i.test(lower)) detectedCurrency = "JPY";

      if (detectedCurrency) {
        const newCurr = detectedCurrency;
        setDraft((prev) => (prev ? { ...prev, currency: newCurr } : prev));
        setAnswers((prev) => ({ ...prev, currency: [newCurr] }));
        setCanvasCards((prev) =>
          prev.map((card) =>
            card.type === "draft-preview"
              ? { ...card, payload: { ...card.payload, currency: newCurr } }
              : card,
          ),
        );
      }

      // Once a proposal exists, a change to it is a change to the whole
      // proposal, not a note stapled to the side of one.
      if (draft) {
        void redraftWith(trimmed, detectedCurrency);
        return;
      }

      // Before the proposal exists, the thing on screen is the item list, so
      // that is what a refinement should change.
      if (clarify) {
        void refineItems(trimmed);
        return;
      }

      // Nothing drafted at all yet. The requirement is held for the first draft.
      pushMessage({
        id: nextMsgId(),
        role: "system",
        type: "ai-text",
        text: detectedCurrency
          ? `✓ Quotation currency set to **${detectedCurrency}**, and the rest of what you said is recorded. Both go into the draft when the terms are settled.`
          : `✓ Recorded: “${trimmed}”\n\nIt goes into the draft when the terms are settled, and to every supplier with the invitation.`,
      });
    },
    [draft, clarify, redraftWith, refineItems]
  );

  // Register workspace command handler with ChatContext
  useEffect(() => {
    registerWorkspaceHandler((text: string) => {
      if (stage === "idle" || !clarify) {
        startClarify(text);
      } else {
        handleUserMutation(text);
      }
    });

    return () => {
      registerWorkspaceHandler(null);
    };
  }, [registerWorkspaceHandler, stage, clarify, startClarify, handleUserMutation]);

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
        {/* ──── LEFT PANE: the conversation, and the box it is typed into ──── */}
        <div
          className="relative flex flex-col border-r border-[var(--line)] bg-[var(--surface-sunken)]"
          style={{ width: "var(--builder-pane)" }}
        >
          <PaneResizer
            width={pane.width}
            min={pane.min}
            max={pane.max}
            offset={240}
            onResize={pane.set}
            onReset={pane.reset}
            label="Conversation width"
          />

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
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

          <div
            className="shrink-0 px-3 py-3"
            style={{ borderTop: "1px solid var(--line)", background: "var(--surface-sunken)" }}
          >
            <ChatComposer compact placeholder="Describe or refine your RFx…" />
          </div>
        </div>

        {/* ──── RIGHT PANE: Output Canvas ──── */}
        <div className="flex min-w-0 flex-1 flex-col bg-[var(--surface)]">
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-6">
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
                    terms={settledTerms()}
                    onReuseItems={reuseItemsFrom}
                    onDraftChange={applyDraftEdit}
                    onTermChange={applyTermEdit}
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
  terms: SettledTerm[];
  onReuseItems: (source: SimilarRfx) => void;
  onDraftChange: (next: RfxDraft) => void;
  onTermChange: (key: string, answer: string) => void;
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
          sourceLabel={card.payload.sourceLabel}
          onConfirm={ctx.onConfirmItemList}
        />
      );
    case "similar-events":
      return (
        <SimilarEventsCanvas
          key={card.id}
          similar={card.payload as SimilarRfx[]}
          onReuse={ctx.onReuseItems}
        />
      );
    case "prior-procurement":
      return <PriorProcurementCanvas key={card.id} records={card.payload as SimilarPastProcurement[]} />;
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
          terms={ctx.terms}
          onDraftChange={ctx.onDraftChange}
          onTermChange={ctx.onTermChange}
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
  sourceLabel,
  onConfirm,
}: {
  initialItems: DraftLineItem[];
  category: string;
  isConfirmed?: boolean;
  /** Set when the list was copied rather than drafted, e.g. from a past event. */
  sourceLabel?: string;
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
                : sourceLabel
                  ? `${sourceLabel}. ${items.length} items. Review, edit, then confirm — nothing is created until you do.`
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

/**
 * Procurement that already closed, matched against what the buyer just asked for.
 *
 * Offered as context, never as a template. These records hold a category, a
 * winner and a price, and no line items, so there is nothing to clone from them
 * and no button here pretends otherwise. What they are good for is the question
 * a buyer actually asks at this moment: what did this cost last time, and who
 * won it.
 *
 * Nothing here changes the draft on its own. The clarifying questions and the
 * human confirmation that follow are unchanged — precedent informs the buyer,
 * it does not decide for them.
 */
function PriorProcurementCanvas({ records }: { records: SimilarPastProcurement[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-[var(--line)] bg-[var(--surface-sunken)] px-5 py-3">
        <span
          className="flex h-6 w-6 items-center justify-center rounded-lg"
          style={{ background: "var(--surface-inverse)", color: "var(--ink-inverse)" }}
        >
          <Icon name="clock" size={13} />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-[var(--ink)]">You have bought this before</p>
          <p className="text-[11.5px] text-[var(--ink-muted)]">
            {records.length} closed procurement{records.length === 1 ? "" : "s"} matching your request
          </p>
        </div>
      </div>

      <div>
        {records.map((r) => (
          <div key={r.externalId} className="px-5 py-3.5" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="text-[13px] font-medium text-[var(--ink)]">{r.title}</span>
              <span className="num text-[11px] text-[var(--ink-muted)]">
                {new Date(r.completedAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-[var(--ink-secondary)]">
              Awarded to <span className="font-medium text-[var(--ink)]">{r.awardedVendorName}</span> at{" "}
              <span className="num font-medium text-[var(--ink)]">{formatInr(r.awardValueInr)}</span>
              {r.savingsInr != null && (
                <>
                  , saving <span className="num">{formatInr(r.savingsInr)}</span>
                  {r.savingsPct != null && <span className="num"> ({r.savingsPct}%)</span>}
                </>
              )}
            </p>
            {r.matchedOn.length > 0 && (
              <p className="mt-1 text-[11px] text-[var(--ink-muted)]">Matched on: {r.matchedOn.join(", ")}</p>
            )}
          </div>
        ))}
      </div>

      <p
        className="flex items-start gap-2 px-5 py-3 text-[11.5px] leading-relaxed text-[var(--ink-muted)]"
        style={{ borderTop: "1px solid var(--line)", background: "var(--surface-sunken)" }}
      >
        <span className="mt-[1px]">
          <Icon name="info" size={13} />
        </span>
        <span className="measure">
          No line items are held against these records, so there is nothing to copy into your draft. They are shown so
          you can price this against what it cost last time. {records[0]?.basis}
        </span>
      </p>
    </div>
  );
}

// Similar Events Card
function SimilarEventsCanvas({
  similar,
  onReuse,
}: {
  similar: SimilarRfx[];
  onReuse: (source: SimilarRfx) => void;
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
          <p className="text-[11px] text-[var(--ink-muted)]">
            Reuse the item list, or open the event to read it. Copying does not create anything.
          </p>
        </div>
      </div>
      <div className="divide-y divide-[var(--line)]">
        {similar.map((s) => (
          <div key={s.id} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-[var(--ink)]">{s.name}</span>
              <span className="rounded-full bg-[var(--good-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--good)] border border-[var(--good-line)] uppercase">
                {s.status}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
              {s.category} · {s.lineItemCount} items · {s.buyerName ?? "unattributed"}
            </p>
            {s.sampleLineItems.length > 0 && (
              <p className="mt-1 text-[11.5px] text-[var(--ink-secondary)]">
                {s.sampleLineItems.slice(0, 3).join(", ")}
                {s.lineItemCount > 3 ? `, and ${s.lineItemCount - 3} more` : ""}
              </p>
            )}
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => onReuse(s)}
                disabled={s.lineItemCount === 0}
                className="pressable rounded-md bg-[var(--accent)] px-2.5 py-1 text-[12px] font-medium text-[var(--ink-inverse)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Reuse these {s.lineItemCount} items
              </button>
              {/* A new tab, deliberately. Reading the old event should never cost
                  the buyer the draft they are in the middle of writing. */}
              <a
                href={`/events/${s.id}/overview`}
                target="_blank"
                rel="noreferrer"
                className="pressable rounded-md border border-[var(--line-strong)] px-2.5 py-1 text-[12px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
              >
                Open in a new tab
              </a>
            </div>
          </div>
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
  terms,
  onDraftChange,
  onTermChange,
  onConfirm,
  onDiscard,
}: {
  draft: RfxDraft;
  activeBuyer: Buyer | null;
  activeBuyerId: string;
  setActiveBuyerId: React.Dispatch<React.SetStateAction<string>>;
  buyers: Buyer[];
  terms: SettledTerm[];
  onDraftChange: (next: RfxDraft) => void;
  onTermChange: (key: string, answer: string) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const [editing, setEditing] = useState(false);

  // The same date createRfx will send, computed the same way, so the preview
  // cannot promise a deadline the event does not get.
  const requiredBy = new Date();
  requiredBy.setDate(requiredBy.getDate() + (draft.suggestedRequiredByDays || 30));

  const set = (patch: Partial<RfxDraft>) => onDraftChange({ ...draft, ...patch });

  const setItem = (index: number, patch: Partial<DraftLineItem>) =>
    set({ lineItems: draft.lineItems.map((li, i) => (i === index ? { ...li, ...patch } : li)) });

  const removeItem = (index: number) =>
    set({ lineItems: draft.lineItems.filter((_, i) => i !== index) });

  const addItem = () =>
    set({ lineItems: [...draft.lineItems, { name: "", specification: "", quantity: 1, unit: "pcs" }] });

  // The date is what a buyer thinks in; the draft stores a horizon in days, so
  // the conversion happens here rather than leaving two fields to disagree.
  const setRequiredByDate = (iso: string) => {
    if (!iso) return;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const chosen = new Date(`${iso}T00:00:00`);
    const days = Math.round((chosen.getTime() - midnight.getTime()) / 86_400_000);
    set({ suggestedRequiredByDays: Math.max(1, days) });
  };

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
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                value={draft.name}
                onChange={(e) => set({ name: e.target.value })}
                aria-label="Event name"
                className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[14px] font-bold text-[var(--ink)] outline-none focus:border-[var(--ink)]"
              />
            ) : (
              <p className="text-[14px] font-bold text-[var(--ink)]">{draft.name}</p>
            )}
            <p className="mt-0.5 text-[12px] text-[var(--ink-muted)]">
              {draft.category} · {draft.currency} · {draft.lineItems.length} items
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Correcting a line here beats going back to the chat to describe the
              correction and waiting for it to be interpreted. */}
          <button
            onClick={() => setEditing((v) => !v)}
            className="pressable rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--ink)] hover:bg-[var(--surface-hover)]"
          >
            {editing ? "Done editing" : "Edit"}
          </button>
          <button
            onClick={onDiscard}
            className="text-[12px] text-[var(--ink-muted)] transition-colors hover:text-[var(--critical)]"
          >
            Discard
          </button>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {editing ? (
          <textarea
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={3}
            aria-label="Scope description"
            className="w-full resize-y rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 py-2 text-[13px] leading-relaxed text-[var(--ink)] outline-none focus:border-[var(--ink)]"
          />
        ) : (
          <p className="text-[13px] leading-relaxed text-[var(--ink-secondary)]">{draft.description}</p>
        )}

        {/* What the supplier will be told, gathered in one place.
            Reading it back out of the conversation is work the buyer should not
            have to do twice, and a term that only exists in the transcript is a
            term nobody checks. */}
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Requirement summary
          </p>

          <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[12.5px]">
            <dt className="self-center text-[var(--ink-muted)]">Category</dt>
            <dd className="font-medium text-[var(--ink)]">
              {editing ? (
                <input
                  value={draft.category}
                  onChange={(e) => set({ category: e.target.value })}
                  aria-label="Category"
                  className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
              ) : (
                draft.category
              )}
            </dd>

            <dt className="self-center text-[var(--ink-muted)]">Quotation currency</dt>
            <dd className="num font-medium text-[var(--ink)]">
              {editing ? (
                <select
                  value={draft.currency}
                  onChange={(e) => set({ currency: e.target.value })}
                  aria-label="Quotation currency"
                  className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                >
                  {["INR", "USD", "EUR", "GBP", "JPY"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : (
                draft.currency
              )}
            </dd>

            <dt className="self-center text-[var(--ink-muted)]">Line items</dt>
            <dd className="num font-medium text-[var(--ink)]">{draft.lineItems.length}</dd>

            <dt className="self-center text-[var(--ink-muted)]">Required by</dt>
            <dd className="font-medium text-[var(--ink)]">
              {editing ? (
                <input
                  type="date"
                  value={requiredBy.toISOString().slice(0, 10)}
                  onChange={(e) => setRequiredByDate(e.target.value)}
                  aria-label="Required by"
                  className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                />
              ) : (
                requiredBy.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
              )}
            </dd>
          </dl>

          {terms.length > 0 && (
            <div className="mt-3.5 border-t border-[var(--line)] pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Commercial &amp; delivery terms
              </p>
              <dl className="mt-2 space-y-1.5 text-[12.5px]">
                {terms.map((t) => (
                  /* Reading, the question is context and the answer is the point,
                     so they sit on one line. Editing, the field needs the width,
                     so the question moves above it. */
                  <div
                    key={t.key}
                    className={editing ? "" : "grid grid-cols-[auto_1fr] items-center gap-x-5"}
                  >
                    <dt className={`text-[var(--ink-muted)] ${editing ? "mb-1" : ""}`}>{t.question}</dt>
                    <dd className="font-medium text-[var(--ink)]">
                      {editing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={t.answer}
                            onChange={(e) => onTermChange(t.key, e.target.value)}
                            aria-label={t.question}
                            className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                          />
                          {/* Emptying a term drops it rather than sending a blank
                              condition to the supplier. */}
                          <button
                            onClick={() => onTermChange(t.key, "")}
                            title="Remove this term"
                            className="pressable rounded p-1 text-[var(--ink-muted)] hover:text-[var(--critical)]"
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                      ) : (
                        t.answer
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {draft.assumptions.length > 0 && (
            <div className="mt-3.5 border-t border-[var(--line)] pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--warning)" }}>
                Filled in for you — correct anything wrong
              </p>
              <ul className="mt-2 space-y-1">
                {draft.assumptions.map((a, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-[var(--ink-secondary)]">
                    <span className="mt-[3px] shrink-0" style={{ color: "var(--warning)" }}>
                      <Icon name="alert" size={11} />
                    </span>
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--ink-muted)]">
            Everything above is carried into the invitation each supplier receives, alongside the item list.
          </p>
        </div>

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
                  {editing && <th className="px-2 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {draft.lineItems.map((li, i) =>
                  editing ? (
                    <tr key={i}>
                      <td className="px-2 py-1.5">
                        <input
                          value={li.name}
                          onChange={(e) => setItem(i, { name: e.target.value })}
                          aria-label={`Item ${i + 1} name`}
                          className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={li.specification}
                          onChange={(e) => setItem(i, { specification: e.target.value })}
                          aria-label={`Item ${i + 1} specification`}
                          className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          value={li.quantity}
                          onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 0 })}
                          aria-label={`Item ${i + 1} quantity`}
                          className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)] num text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={li.unit}
                          onChange={(e) => setItem(i, { unit: e.target.value })}
                          aria-label={`Item ${i + 1} unit`}
                          className="w-full rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12.5px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => removeItem(i)}
                          title="Remove this item"
                          className="pressable rounded p-1 text-[var(--ink-muted)] hover:text-[var(--critical)]"
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={i} className="hover:bg-[var(--surface-sunken)]">
                      <td className="px-3 py-2 font-medium text-[var(--ink)]">{li.name}</td>
                      <td className="px-3 py-2 text-[var(--ink-muted)]">{li.specification}</td>
                      <td className="px-3 py-2 text-right font-medium text-[var(--ink-secondary)]">
                        {li.quantity.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-2 text-[var(--ink-muted)]">{li.unit}</td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          {editing && (
            <button
              onClick={addItem}
              className="pressable mt-2 rounded-md border border-dashed border-[var(--line-strong)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--ink-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--ink)]"
            >
              + Add a line item
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--good-line)] bg-[var(--good-soft)] px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[12px] text-[var(--ink-muted)]">
            <span>Raising as</span>
            <select
              value={activeBuyerId || buyers[0]?.id || "buyer-prem"}
              onChange={(e) => setActiveBuyerId(e.target.value)}
              className="rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
            >
              {buyers.length > 0 ? (
                buyers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.team}
                  </option>
                ))
              ) : (
                <option value="buyer-prem">Prem Kumar — Packaging Sourcing</option>
              )}
            </select>
          </div>
          <Button
            onClick={onConfirm}
            disabled={false}
            title="Click to finalize and create this RFx event"
            className="!bg-[var(--good)] hover:!bg-[var(--good)] !px-6 cursor-pointer"
          >
            <Icon name="check" size={14} /> Confirm and create RFx
          </Button>
        </div>
      </div>
    </div>
  );
}
