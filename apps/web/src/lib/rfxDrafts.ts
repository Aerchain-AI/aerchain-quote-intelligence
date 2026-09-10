/**
 * Unfinished RFx drafts, kept where the buyer can get back to them.
 *
 * The builder used to hold one draft in sessionStorage, and clicking "New RFx"
 * cleared it without asking. A buyer who opened a past event to check something
 * and then came back through the sidebar lost the conversation, the item list
 * and every correction they had made, with nothing anywhere to recover it from.
 *
 * Drafts live in localStorage now, as a list rather than a slot, so starting a
 * new one leaves the old one alone. They survive a closed tab and a restarted
 * browser. They do not survive a different machine: nothing here is written to
 * the server, because a draft is not an event and creating rows for something
 * the buyer has not confirmed is how a system ends up full of half-RFxs nobody
 * remembers starting.
 */

const KEY = "qic.rfx.drafts";
const LIMIT = 12;

export interface StoredDraft<TState = unknown> {
  id: string;
  /** What the buyer would recognise it by: their own words, or the draft name. */
  title: string;
  /** e.g. "Item review", "Commercial terms" — where they left off. */
  stageLabel: string;
  itemCount: number;
  updatedAt: string;
  state: TState;
}

function readAll(): StoredDraft[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(drafts: StoredDraft[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(drafts.slice(0, LIMIT)));
  } catch {
    // A full or disabled store is not a reason to break the builder. The draft
    // stays in memory for this session either way.
  }
}

/** Newest first, so a dashboard can show the last thing abandoned. */
export function listDrafts(): StoredDraft[] {
  return readAll().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function loadDraft<TState>(id: string): StoredDraft<TState> | null {
  return (readAll().find((d) => d.id === id) as StoredDraft<TState> | undefined) ?? null;
}

export function mostRecentDraftId(): string | null {
  return listDrafts()[0]?.id ?? null;
}

export function saveDraft<TState>(draft: Omit<StoredDraft<TState>, "updatedAt">): void {
  const others = readAll().filter((d) => d.id !== draft.id);
  writeAll(
    [{ ...draft, updatedAt: new Date().toISOString() } as StoredDraft, ...others].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
  );
}

export function removeDraft(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function newDraftId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
