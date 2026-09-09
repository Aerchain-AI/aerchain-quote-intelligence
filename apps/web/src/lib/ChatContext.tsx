import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useLocation, useNavigate } from "react-router-dom";

export interface AttachedFile {
  name: string;
  size: number;
  type: string;
}

export type ChatContextType = {
  route: string;
  entityType?: "prx" | "vendor" | "approval" | "comparison" | "builder";
  entityId?: string;
  sourcingEventId?: string;
  selectedVendorId?: string;
  selectedLineItemId?: string;
  contextLabel?: string;
};

// Intent types returned by the classifier
export type IntentType = "sourcing_request" | "event_query" | "workspace_command" | "general";

export interface ClassifiedIntent {
  type: IntentType;
  text: string;
  confidence: number;
  /** For event_query: matched event ID */
  matchedEventId?: string;
}

// Workspace command dispatch — RfxBuilderScreen registers a handler
export type WorkspaceCommandHandler = (text: string) => void;

export interface ChatTurn {
  id: string;
  question: string;
  answer: string | null;
  caveats: string[];
  supported: boolean;
  error: string | null;
}

interface ChatContextValue {
  chatInput: string;
  setChatInput: (val: string) => void;
  attachments: AttachedFile[];
  setAttachments: React.Dispatch<React.SetStateAction<AttachedFile[]>>;
  isDraggingOver: boolean;
  setIsDraggingOver: (val: boolean) => void;
  activeContext: ChatContextType;
  placeholderText: string;
  submitChat: (overrideText?: string) => void | Promise<void>;
  /** Answers for the event currently in scope. Cleared when the scope changes,
   * so one event's conversation never appears under another. */
  thread: ChatTurn[];
  threadBusy: boolean;
  clearThread: () => void;
  /** RfxBuilderScreen registers its handler here to receive inline commands */
  registerWorkspaceHandler: (handler: WorkspaceCommandHandler | null) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

// ─── Intent Classifier (rule-based for now) ─────────────────────────────────
const SOURCING_KEYWORDS = [
  "i need", "we need", "buy", "purchase", "procure", "source", "rfx", "rfq",
  "looking for", "require", "get me", "order", "quotation for", "want to buy",
  "materials", "items", "supplies", "equipment",
];

const EVENT_QUERY_PATTERNS = [
  /where (?:are|is) (?:we|the|my).*(?:on|with) (.+)/i,
  /status (?:of|on) (.+)/i,
  /update (?:on|about) (.+)/i,
  /how is (.+) going/i,
  /check (.+) event/i,
];

function classifyIntent(text: string, isOnBuilder: boolean): ClassifiedIntent {
  const lower = text.toLowerCase().trim();

  // If user is already on the builder, treat as a workspace command
  if (isOnBuilder) {
    return { type: "workspace_command", text, confidence: 0.9 };
  }

  // Check for event query patterns
  for (const pattern of EVENT_QUERY_PATTERNS) {
    const match = lower.match(pattern);
    if (match) {
      return { type: "event_query", text, confidence: 0.85, matchedEventId: match[1]?.trim() };
    }
  }

  // Check for sourcing intent
  const hasSourcingKeyword = SOURCING_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasSourcingKeyword) {
    return { type: "sourcing_request", text, confidence: 0.9 };
  }

  return { type: "general", text, confidence: 0.5 };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [chatInput, setChatInput] = useState("");
  const [attachments, setAttachments] = useState<AttachedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [thread, setThread] = useState<ChatTurn[]>([]);
  const [threadBusy, setThreadBusy] = useState(false);
  /** Which event the current thread belongs to. */
  const threadScopeRef = useRef<string | null>(null);
  const workspaceHandlerRef = useRef<WorkspaceCommandHandler | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  // Dynamic context resolver based on current route
  const activeContext = useMemo<ChatContextType>(() => {
    const pathname = location.pathname;
    const match = pathname.match(/\/events\/([^/]+)(?:\/([^/]+))?/);

    if (match) {
      const sourcingEventId = match[1];
      const subRoute = match[2] || "overview";

      if (sourcingEventId === "new") {
        return {
          route: pathname,
          entityType: "builder",
          contextLabel: "AI RFx Builder",
        };
      }

      const entityType = subRoute === "comparison" ? "comparison" : "prx";
      const label =
        subRoute === "comparison"
          ? `Comparison Workspace (RFx #${sourcingEventId.slice(0, 8)})`
          : `Event RFx #${sourcingEventId.slice(0, 8)}`;

      return {
        route: pathname,
        entityType,
        sourcingEventId,
        contextLabel: label,
      };
    }

    if (pathname.startsWith("/approvals")) {
      return { route: pathname, entityType: "approval", contextLabel: "RFx Approval Workspace" };
    }

    if (pathname.startsWith("/vendors")) {
      return { route: pathname, entityType: "vendor", contextLabel: "Supplier Directory" };
    }

    return { route: pathname, contextLabel: "General Procurement Workspace" };
  }, [location.pathname]);

  // A thread belongs to one event. Moving to a different event starts a new one
  // rather than showing the previous event's answers under the new heading.
  useEffect(() => {
    const scope = activeContext.sourcingEventId ?? activeContext.entityType ?? "global";
    if (threadScopeRef.current !== scope) {
      threadScopeRef.current = scope;
      setThread([]);
    }
  }, [activeContext]);

  // Contextual bottom bar placeholder
  const placeholderText = useMemo(() => {
    if (activeContext.entityType === "comparison") return "Ask about this comparison…";
    if (activeContext.entityType === "builder") return "Describe what you need, or refine your RFx draft…";
    if (activeContext.sourcingEventId) return `Ask about event #${activeContext.sourcingEventId.slice(0, 8)}…`;
    return "Describe what you're sourcing, or ask about any event…";
  }, [activeContext]);

  const registerWorkspaceHandler = useCallback((handler: WorkspaceCommandHandler | null) => {
    workspaceHandlerRef.current = handler;
  }, []);

  const submitChat = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? chatInput).trim();
      if (!text && attachments.length === 0) return;

      // Clear input
      if (!overrideText) {
        setChatInput("");
        setAttachments([]);
      }

      const isOnBuilder = location.pathname === "/events/new";

      // Inside an event, a question is about THAT event. Sending it to the RFx
      // builder was why the chat appeared to "continue a previous conversation":
      // it navigated away and reopened the builder's own transcript.
      const scopedEventId = activeContext.sourcingEventId;
      if (scopedEventId && scopedEventId !== "new" && !isOnBuilder) {
        const id = `${Date.now()}`;
        setThread((prev) => [...prev, { id, question: text, answer: null, caveats: [], supported: true, error: null }]);
        setThreadBusy(true);
        try {
          const answer = await api.askCopilot(scopedEventId, text);
          setThread((prev) =>
            prev.map((t) =>
              t.id === id
                ? { ...t, answer: answer.answer, caveats: answer.caveats, supported: answer.supported }
                : t,
            ),
          );
        } catch (err) {
          setThread((prev) => prev.map((t) => (t.id === id ? { ...t, error: (err as Error).message } : t)));
        } finally {
          setThreadBusy(false);
        }
        return;
      }

      const intent = classifyIntent(text, isOnBuilder);

      switch (intent.type) {
        case "sourcing_request": {
          // Clear any prior draft and auto-route to builder with prompt
          sessionStorage.removeItem("qic.rfx.inProgress");
          navigate(`/events/new?fresh=true&prompt=${encodeURIComponent(text)}`);
          break;
        }

        case "event_query": {
          // For now navigate to events list — future: match event by name
          navigate("/events");
          break;
        }

        case "workspace_command": {
          // Dispatch to RfxBuilderScreen's registered handler
          if (workspaceHandlerRef.current) {
            workspaceHandlerRef.current(text);
          }
          break;
        }

        case "general":
        default: {
          // If text looks procurement-ish, route to builder anyway
          if (text.length > 10) {
            sessionStorage.removeItem("qic.rfx.inProgress");
            navigate(`/events/new?fresh=true&prompt=${encodeURIComponent(text)}`);
          }
          break;
        }
      }
    },
    [chatInput, attachments, location.pathname, navigate, activeContext],
  );

  return (
    <ChatContext.Provider
      value={{
        chatInput,
        setChatInput,
        attachments,
        setAttachments,
        isDraggingOver,
        setIsDraggingOver,
        activeContext,
        placeholderText,
        submitChat,
        thread,
        threadBusy,
        clearThread: () => setThread([]),
        registerWorkspaceHandler,
      }}
    >
      <div
        className="contents"
        onDragOver={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDragLeave={() => setIsDraggingOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingOver(false);
          if (e.dataTransfer.files) {
            const accepted = Array.from(e.dataTransfer.files).filter((f) =>
              [
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/msword",
                "image/png",
                "image/jpeg",
                "image/jpg",
                "text/plain",
              ].includes(f.type)
            );
            setAttachments((prev) => [
              ...prev,
              ...accepted.map((f) => ({ name: f.name, size: f.size, type: f.type })),
            ]);
          }
        }}
      >
        {children}
      </div>
    </ChatContext.Provider>
  );
}

export function useGlobalChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useGlobalChat must be used within ChatProvider");
  return ctx;
}
