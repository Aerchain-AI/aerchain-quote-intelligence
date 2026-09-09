# Live demo script

Roughly eight minutes. Everything below runs on the shipped database, so no step depends on an API
call, a network round-trip, or model latency. The one optional step that does is flagged.

**Before you start:** open the app, sign in as **Priya Sharma** (PIN `1234`), and leave it on the
sourcing register. Have the FY27 packaging event open in a second tab so you never wait on a load
in front of anyone.

---

## The claim you are making

> An LLM reads the documents. It never does the arithmetic. Every number a buyer sees is computed
> by deterministic code, and every one of them opens up to show its own working.

Everything below is in service of that one sentence. If you only get three minutes, do steps 3 and 4.

---

## 1 — The problem, in one screen (60s)

Open the FY27 packaging event → **Vendor responses**.

Ten suppliers answered the same 30-line RFx in five different file formats: a spreadsheet, a PDF, a
Word document, a photograph of a printed sheet, and an informal email. Point at the format column.

> "This is what a buyer actually receives. Nobody sends you a clean spreadsheet."

Each row shows what the pipeline recovered: items found, items missing, confidence, exceptions.
Two vendors quoted 27 of 30 items. That gap is detected, not assumed.

## 2 — Comparison (90s)

→ **Comparison**.

Thirty rows, ten columns, one currency, one unit basis. Call out three cells:

- A value marked **from USD** — Vendor C priced in dollars; the rate used is disclosed on the cell.
- A cell reading **Not quoted** — never `₹0`. An unpriced item is missing information, and treating
  it as free would silently hand that vendor the cheapest total.
- An amber **Review required** cell — a faint price on the photographed quote that the model was
  unsure about. It is surfaced, not buried.

Click any cell to see the source document, the extracted value, and the confidence.

## 3 — The click-to-prove moment (2 min)

This is the centre of the demo. Do not rush it.

→ **Award recommendation**.

The engine recommends a split across five quality-qualified vendors, at ₹58,27,540, saving
₹8,43,460.

> "Any dashboard can print a savings number. The question a CFO asks is: against what?"

**Click the savings figure.**

Walk the panel top to bottom:

1. **The rule** — savings are measured against the cheapest single supplier that could have covered
   the whole award on its own. Not against a budget, not against the most expensive quote received.
2. **The arithmetic** — baseline minus split total, both named.
3. **Line by line** — all 30 awarded items, each shown both ways, sorted by contribution. The
   column adds to the headline.
4. **What is not counted** — the two vendors excluded on quality before any price was compared, and
   why items with no usable price contribute nothing rather than zero.
5. **Verification** — three checks that recompute the number by a different route and agree.

> "None of this text came from a model. The same function that computed the number emitted the
> explanation, which is why they cannot disagree."

Then click **Total evaluated cost**, **Awarded items**, and a **vendor's column total** on the
comparison to show the same treatment applies everywhere, including to the register's portfolio
headline.

## 4 — Where the system refuses (90s)

Still on the award screen, point at the amber banner at the top.

Three extracted values the model flagged as uncertain sit on lines the recommendation depends on.
The recommendation is still shown in full — marked **provisional**, with exactly what to check.

> "It does not block you and it does not pretend. A system that hides its work cannot be audited,
> and one that refuses to answer is useless."

Then scroll to **Review before award**: unresolved quality answers, unspecified freight, missing
tax. A vendor that answered "no" to a gating question is excluded. A vendor that left it *blank* is
only flagged, because a blank is not a no, and dropping a supplier on a question they never answered
is a decision the buyer never made.

## 5 — Ask it something (60s)

Use the chat bar at the bottom of the comparison:

> **Which vendors did not quote all items?**

The answer names them and the count. The copilot routes the question to a fixed analysis, the engine
computes it, and the model only phrases the result it was handed.

Good follow-ups: *"What is the cheapest vendor overall?"*, *"What happens if Vendor B gives another
5% discount?"*

## 6 — Optional: live extraction (90s, needs an API key)

Only do this if the deployed instance has `GEMINI_API_KEYS` set and you have quota left today.

→ **Vendor responses** → drag in a quote file. Watch classify → parse → extract → normalize →
validate run, and the new column appear in the comparison.

**Free-tier quota is 20 requests per model per day per key.** If you have already demoed today, skip
this step — the point is made without it. Check first with:

```bash
npm run key-status
```

---

## If something goes wrong

| Symptom | What to do |
|---|---|
| A screen is empty | The database did not restore. Restart the process; it copies `demo.db` on boot. |
| Upload fails with a quota message | Expected on the free tier. Skip step 6; nothing else needs a key. |
| The hosted instance is slow to first load | Free-tier hosts sleep. Open the URL two minutes before you start. |

## What to say if asked "why not just have the LLM do it?"

Because the arithmetic has to be reproducible and auditable. A model asked to total thirty line
items will usually be right and occasionally be confidently wrong, and there is no way to tell which
from the output. Splitting the work means the model does what it is good at — reading a photographed
invoice, interpreting a question — and the parts a buyer signs their name to are computed by code
you can test. There are 70 unit tests over that code, plus nine trust guarantees checked against the
live extracted data (`npm run break-tests`).
