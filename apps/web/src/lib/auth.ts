/**
 * Demo-mode authentication context.
 *
 * This is prototype-level auth only — no real passwords, no server sessions.
 * Every buyer profile is defined here with a fixed email/PIN so the demo feels
 * complete without needing a real auth backend.
 *
 * PRD §34: "No production auth in this prototype."
 */

export interface DemoProfile {
  id: string;
  name: string;
  email: string;
  team: string;
  role: string;
  avatar: string; // initials
  pin: string;    // 4-digit demo PIN
  /** Avatar tint. Distinct per person, desaturated, and deliberately not one of
   * the status colours — an emerald avatar reads as "passed" on this screen. */
  accentColor: string;
}

export const DEMO_PROFILES: DemoProfile[] = [
  {
    id: "buyer-001",
    name: "Priya Sharma",
    email: "priya.sharma@aerchain.io",
    team: "Packaging Procurement",
    role: "Senior Buyer",
    avatar: "PS",
    pin: "1234",
    accentColor: "bg-[#4a5568]",
  },
  {
    id: "buyer-002",
    name: "Rahul Mehta",
    email: "rahul.mehta@aerchain.io",
    team: "Indirect Procurement",
    role: "Category Manager",
    avatar: "RM",
    pin: "2345",
    accentColor: "bg-[#7c6f64]",
  },
  {
    id: "buyer-003",
    name: "Ananya Iyer",
    email: "ananya.iyer@aerchain.io",
    team: "Direct Procurement",
    role: "Procurement Lead",
    avatar: "AI",
    pin: "3456",
    accentColor: "bg-[#5b6b5a]",
  },
  {
    id: "buyer-004",
    name: "Karthik Nair",
    email: "karthik.nair@aerchain.io",
    team: "Strategic Sourcing",
    role: "Sourcing Analyst",
    avatar: "KN",
    pin: "4567",
    accentColor: "bg-[#8a6a5c]",
  },
];

const SESSION_KEY = "aerchain.demo.session";

export function getSession(): DemoProfile | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DemoProfile;
  } catch {
    return null;
  }
}

export function setSession(profile: DemoProfile): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
