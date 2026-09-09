# Preparing your own data

The database is empty. This is what to fill in, and the shape to give it in.

Fill the four JSON files in [`data/import/`](../data/import), then run:

```bash
npm run import:data
```

It validates everything before writing a single row, so a mistake in the last
file does not leave you with three-quarters of an import.

---

## First, the one distinction that matters

**"Vendor" means two different things in this system**, and mixing them up is the
easiest way to prepare the wrong data.

| | **Supplier** | **Vendor response** |
|---|---|---|
| What it is | A company in your registry | One supplier's answer to one specific event |
| Lifespan | Permanent, across every event | Belongs to a single event |
| You prepare it | Yes, in `suppliers.json` | No — it is created when a quotation arrives |
| Carries | Contact details, category, track record | A document, extracted prices, exceptions |

You prepare **suppliers**. Vendor responses appear when you upload a quotation or
when one arrives by email. So: `suppliers.json` describes *who you buy from*, and
the quote files you drop in describe *what they offered this time*.

---

## 1. Buyer persona

The person raising the RFx. Every event records who raised it and when, which is
audit trail rather than login.

`data/import/buyers.json`

```json
[
  {
    "name": "Priya Sharma",
    "email": "priya.sharma@yourcompany.com",
    "team": "Packaging Procurement",
    "role": "Senior Buyer",
    "avatar": "PS",
    "pin": "1234"
  }
]
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Shown on the event, in the timeline, and as the email signature |
| `email` | yes | Must be unique. Also the identity key |
| `team` | yes | Appears under their name in the sidebar |
| `role` | no | e.g. Senior Buyer, Category Manager. Display only |
| `avatar` | no | Two initials for the sidebar. Derived from the name if omitted |
| `pin` | no | Four digits for the demo sign-in. Defaults to `1234` |

Prepare **3 to 5**. More than that makes the profile picker unwieldy.

> The sign-in is a demo affordance, not authentication. Do not use a real
> password as the PIN.

---

## 2. Supplier persona

A company you buy from. This is the registry the "choose suppliers" step reads
when you issue an RFx, and the track-record numbers are what order that list.

`data/import/suppliers.json`

```json
[
  {
    "name": "Sundaram Packaging Works",
    "email": "sales@sundarampackaging.com",
    "category": "Corrugated Packaging",
    "pastWork": "Supplied 5-ply cartons and void fill for the Chennai DC through FY26.",
    "eventsInvited": 8,
    "eventsQuoted": 7,
    "eventsAwarded": 3,
    "avgResponseDays": 2.4,
    "onTimeDeliveryPct": 94.2,
    "qualityScore": 0.88,
    "lastEngagedAt": "2026-07-14",
    "isNew": false
  }
]
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Labels their column in the comparison and appears in the award recommendation. Use the real company name — placeholders like "Vendor" are rejected |
| `email` | yes | Must be unique. **This is what matches their emailed reply to the event**, so it has to be the address they actually send from |
| `category` | yes | Must match an event's category exactly, or they will not be offered when you issue that event |
| `pastWork` | no | One line on what they have supplied before. Shown on the supplier picker |
| `eventsInvited` | no | Track record. Defaults to 0 |
| `eventsQuoted` | no | Must not exceed `eventsInvited` |
| `eventsAwarded` | no | Must not exceed `eventsQuoted` |
| `avgResponseDays` | no | Days from invitation to reply |
| `onTimeDeliveryPct` | no | 0–100 |
| `qualityScore` | no | **0–1**, not a percentage. Weighted highest when ordering the picker |
| `lastEngagedAt` | no | `YYYY-MM-DD` |
| `isNew` | no | `true` suppresses the track-record numbers, so a new supplier does not read as a bad one |

Prepare **8 to 15**, across at least two categories.

Give them **messy, specific numbers**. `94.2` and `0.88` read as measured;
`95` and `0.9` read as invented, and an interviewer notices.

---

## 3. Sourcing events

`data/import/events.json`

```json
[
  {
    "name": "Corrugated Packaging — FY27 Sourcing Event",
    "category": "Corrugated Packaging",
    "description": "Corrugated packaging materials supporting FY27 fulfilment operations.",
    "currency": "INR",
    "requiredByDate": "2027-01-15",
    "status": "active",
    "buyerEmail": "priya.sharma@yourcompany.com",
    "lineItems": [
      { "name": "5-Ply Corrugated Box – Small", "specification": "300×200×150 mm", "quantity": 10000, "unit": "pcs" }
    ],
    "invitedSupplierEmails": ["sales@sundarampackaging.com"]
  }
]
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Also used as a matching signal when a reply's subject names the event, so make it distinctive |
| `category` | yes | Must match the suppliers you want offered |
| `description` | yes | Goes into the RFQ document and the invitation email |
| `currency` | yes | `INR` or `USD`. The comparison normalises everything into this |
| `requiredByDate` | yes | `YYYY-MM-DD` |
| `status` | yes | `draft`, `active`, or `awarded`. Only `active` events receive email replies |
| `buyerEmail` | yes | Must exist in `buyers.json` |
| `lineItems` | yes | 1 or more. See below |
| `invitedSupplierEmails` | no | Must all exist in `suppliers.json`. Setting this marks the event issued |

**Line items** need `name`, `quantity` and `unit`; `specification` is optional
but strongly recommended, because it is what lets extraction tell two similar
rows apart. Ids are assigned in order — do not supply them.

Aim for **20 to 30 line items** on the event you plan to demo. Fewer and the
comparison grid does not look like a real sourcing exercise.

Prepare **1 event you will demo in depth**, plus 3 to 6 others in mixed states so
the register looks lived-in.

---

## 4. Quotations

These are files, not JSON. Put one document per supplier response in
`data/import/quotes/`, named `<supplier-email>.<ext>`:

```
data/import/quotes/
  sales@sundarampackaging.com.xlsx
  exports@northwind.example.pdf
  quotes@harbourline.example.jpg
```

Supported: `.xlsx` `.pdf` `.docx` `.jpg` `.png` `.txt` `.csv`

`data/import/quotes/manifest.json` says which event each belongs to:

```json
[
  { "supplierEmail": "sales@sundarampackaging.com", "eventName": "Corrugated Packaging — FY27 Sourcing Event" }
]
```

The importer creates the vendor response rows. It does **not** extract them —
that costs an API call each, so run it deliberately:

```bash
npm run pipeline:demo
```

### What makes a good set of quotations

The product's whole claim is that it handles what buyers actually receive. A set
of five clean spreadsheets demonstrates nothing. Vary them deliberately:

- **One clean spreadsheet.** The baseline everything else is measured against.
- **One PDF with a discount in a footnote** and freight quoted separately, using
  reworded item names rather than yours.
- **One priced in a different currency**, with some per-100 rather than per-unit
  pricing. This proves the currency and unit normalisation.
- **One photograph of a printed sheet** — genuinely photographed, slightly
  skewed, with one or two faint prices. This is the hardest input and the one
  worth showing.
- **One informal email** that quotes most items and says "rest as per last year"
  for the others.

**Leave gaps on purpose.** Have at least two suppliers omit three or four items.
A missing price is never treated as zero, and that is only visible if something
is actually missing.

---

## 5. Questionnaire answers (optional)

Ten fixed questions, seven of which gate quality. If a quotation document does
not answer them, extraction leaves them blank and the vendor is flagged as
unresolved rather than rejected.

| # | Question | Gates quality |
|---|---|---|
| 1 | Is the vendor ISO 9001 certified? | yes |
| 2 | At least 3 years of packaging experience? | yes |
| 3 | Can they provide samples before production? | yes |
| 4 | Maximum standard lead time? | no |
| 5 | Can they support the required monthly volume? | yes |
| 6 | Does the material meet the required GSM/specification? | yes |
| 7 | Can they provide batch-level quality documentation? | yes |
| 8 | Can they support emergency orders? | yes |
| 9 | What payment terms do they require? | no |
| 10 | Have they supplied similar enterprise customers? | no |

To demonstrate the quality gate properly, have **one supplier answer "no"** to a
gating question, and **one leave a gating question blank**. Those are treated
differently on purpose: a no disqualifies, a blank is only flagged, because
dropping a supplier over a question they never answered is a decision the buyer
never made.

---

## 6. Email replies (optional)

If you want the inbox flow, drop `.eml` files in `data/inbound-samples/`, or
generate a set from your invitation list once the events are imported:

```bash
npm run generate:inbound-samples
```

---

## Order of operations

```bash
npm run import:data          # buyers, suppliers, events, line items, quote rows
npm run pipeline:demo         # extraction — costs one API call per quotation
npm run generate:inbound-samples   # optional: sample supplier replies
npm run demo:snapshot          # freeze it as the shipped demo database
```

## Things that will bite you

- **A supplier's `category` must match an event's `category` character for
  character**, or they will not appear when you issue that event.
- **`qualityScore` is 0–1**, while `onTimeDeliveryPct` is 0–100. Mixing these up
  puts a supplier at the wrong end of the picker.
- **Supplier emails must be the addresses they actually reply from**, or inbound
  matching falls back to the subject line and holds the reply for confirmation.
- **Round numbers read as fake.** `47.2%` and `₹1,84,320` look measured;
  `50%` and `₹2,00,000` do not.
- **Do not reuse a real person's name and real employer together.** These records
  are visible to anyone you send the prototype to.
