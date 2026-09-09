# BUILD_PLAN.md — Quote Intelligence Copilot

## The product, in one line

Messy vendor responses → trustworthy comparison → sourcing analysis → a decision the buyer can defend.

## The demo spine (everything serves this)

```
CREATE RFx
    ↓
30 LINE ITEMS
    ↓
5 VENDOR RESPONSES
    ↓
AI EXTRACTS
    ↓
AI NORMALIZES
    ↓
AI VALIDATES
    ↓
EXCEPTIONS
    ↓
COMPARISON
    ↓
ASK AI
    ↓
SCENARIO ANALYSIS
    ↓
AWARD RECOMMENDATION
    ↓
EVIDENCE + CONFIDENCE
```

---

## Must Have

- [x] RFx creation
- [x] 30 line items
- [x] 5 vendors
- [x] Vendor response ingestion
- [x] Extraction
- [x] Normalization
- [x] Validation
- [x] Comparison (data layer)
- [x] Exceptions
- [x] Comparison workspace (UI, 30 × 5, clickable cells)
- [x] Exception center (filter + counts by type)
- [x] AI questions (5 guaranteed, plus scenario and unsupported handling)
- [x] Scenario analysis
- [x] Source/evidence drill-down
- [x] Final recommendation
- [x] Procurement impact metrics (labelled measured vs target)

## Nice to Have (only if the core is done and solid)

- Animations
- Advanced dashboard
- Authentication
- Vendor portal
- Email integration
- Real RFx sending
- ERP integration
- Complex permissions

## Absolutely Do Not Build

- Full procurement suite
- Payment
- Contract management
- Supplier management
- ERP integration
- Complex admin

**Standing rule:** if a feature doesn't strengthen the core demo, it doesn't get built.

---

## Architecture

```
Frontend            React + TypeScript + Vite + Tailwind
       ↓
Backend/API         Node + Express (one service)
       ↓
Database            SQLite via Prisma
       ↓
AI Service          Gemini (gemini-3.6-flash) — extraction + explanation only
       ↓
Structured procurement data
```

### The decision that matters: AI is separated from calculation

**LLM is responsible for:**
- Understanding documents (5 formats, including a photographed quote)
- Extracting information into a fixed schema
- Interpreting natural-language questions
- Generating explanations

**Code is responsible for:**
- Totals
- Currency calculations
- Unit conversions
- Rankings
- Savings
- Filtering
- Constraints

The LLM never does arithmetic that ends up in front of the buyer. It reads documents and it explains
results; every number comes from `calc/engine.ts`. That is why the numbers are reproducible and the
recommendation is defensible.

---

## Data model

```
RFx
 ├── lineItems[]
 ├── vendors[]
 ├── questionnaire
 └── responses[]

Vendor
 ├── profile
 ├── response
 ├── questionnaire
 └── documents[]

VendorQuote
 ├── lineItemId
 ├── originalPrice / originalCurrency / originalUnit
 ├── normalizedPrice / normalizedCurrency / normalizedUnit
 ├── evaluatedValue
 ├── confidence
 ├── exceptions[]
 └── sourceReference (document + location + excerpt)
```

**Hard rule:** the comparison screen contains no hardcoded prices. It renders whatever the pipeline
extracted. If extraction changes, the screen changes.

---

## Validation rules (deterministic)

```
IF expected item missing      → MISSING_ITEM
IF currency != INR             → CURRENCY_MISMATCH
IF unit != expected unit       → UNIT_MISMATCH
IF confidence < threshold      → LOW_CONFIDENCE
IF freight unknown             → FREIGHT_UNKNOWN
IF discount detected           → DISCOUNT_DETECTED
IF questionnaire failed        → QUALITY_FAILURE
```

---

## The 5 questions the copilot must answer excellently

1. Who is cheapest overall?
2. Who is cheapest for each item?
3. What if we split the order by the cheapest vendor for each line?
4. Only consider vendors who passed the quality questionnaire.
5. What are the biggest risks with Vendor B?

Five excellent answers, not fifty shallow ones. Anything outside the dataset gets
"I don't have enough information to determine that."

---

## Deliberate break-tests (all passing — `npm run break-tests`)

| # | Test | Required behaviour |
|---|------|--------------------|
| 1 | Vendor missing an item | Shows **Not quoted**, never ₹0 |
| 2 | Vendor quotes USD | Normalizes, shows rate + original |
| 3 | Vendor uses a different unit | Converts, or flags if not derivable |
| 4 | Low-confidence image value | Visibly flagged, not asserted as fact |
| 5 | Freight unknown | **Freight not specified**, never ₹0 |
| 6 | Quality failure | Vendor excluded under quality constraint |
| 7 | Unanswerable question | "I don't have enough information to determine that." |

---

## Metrics honesty rule

Every number on the impact panel is labelled either:

- **Prototype measurement** — actually measured from this system's own run
- **Target** — an assignment assumption, not a measured result

No invented performance claims.


---

## Where it landed

Run `npm run break-tests` for the live proof. Latest run, against real extracted data:

```
PASS  1. Missing item is not treated as zero          6 unquoted cells, all null not 0
PASS  2. USD quotes normalized, rate disclosed        30/30 with an attached FX rate
PASS  3. Bulk unit basis converted to per-unit        7/7 normalized below quoted figure
PASS  4. Low-confidence / ambiguous reads flagged     6 exceptions across 6 flagged cells
PASS  5. Unspecified freight reported, not zeroed     3 gaps reported, none invented
PASS  6. Quality constraint excludes failing vendors  Vendor B, Vendor E excluded
PASS  6b. Unanswered questions flag, not disqualify   Vendor D kept eligible and flagged
PASS  7. Vendors ranked only on a shared basket       24/30 basket, 3 caveats stated
PASS  8. Unanswerable question is refused             "I don't have enough information…"
```

Two design decisions worth defending in the interview:

**An unanswered quality question is not a "no".** The first version collapsed both into "failed"
and silently disqualified three of five vendors. That is the same error as printing ₹0 for an
unquoted item — the system deciding something it does not know. Now an explicit "no" disqualifies,
a blank or hedged answer keeps the vendor eligible and flags it for the buyer.

**Vendors are only ranked on a basket they all priced.** Comparing a 30-item total against a
27-item total makes the incomplete vendor look cheaper. The engine intersects coverage, ranks on
that, and states how many items it dropped and why.


---

## Model selection was a measurement, not a preference

The accuracy harness (`metrics/accuracy.ts`) scores every normalized price against the known ground
truth of the generated documents, which made "is the cheap model good enough?" an answerable question
rather than a judgement call.

| Input | `3.5-flash-lite` | `3.5-flash` | `3.7-flash` |
|---|---|---|---|
| xlsx / pdf / docx / txt | **100% / 100%** | — | — |
| photographed quote | 25/27 — drops both faint prices | 25/27 — same | **27/27** |

*(price accuracy / omission detection)*

Two findings worth repeating in the interview:

**The lite model failed in two opposite ways depending on the prompt.** With the original prompt it
scored 28/30 on the photo — by inventing a price for an unquoted item, copied from the adjacent
similarly-named row (PP vs PET Strapping). Hardening the prompt against cross-row attribution fixed
the hallucination but pushed it to 25/30, silently dropping the two faint prices. Neither number is
usable, and the harness is what made the difference visible: 28/30 *looked* better than 25/30 while
being strictly worse.

**A too-low output token cap looked like a model capability problem.** Extraction failed with "no
function call returned" on the photo — not a refusal or a vision limit, but the 30-item function-call
JSON being truncated at `maxOutputTokens`. The error now names the finish reason instead of reporting
a generic miss.
