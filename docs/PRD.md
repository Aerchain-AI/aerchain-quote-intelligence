# PRD — Aerchain Quote Intelligence Copilot
**Working Product Name:** Quote Intelligence Copilot
**Assignment:** Kill the Quote Spreadsheet
**Version:** V1.0
**Primary User:** Category Procurement Buyer
**Prototype Type:** Functional AI-powered web prototype
---
# 1. Product Overview
## 1.1 Product Vision
Build an AI-powered procurement workspace that transforms messy, unstructured vendor quotations into a trustworthy, comparable dataset and helps procurement buyers make faster, defensible sourcing decisions.
The product should replace the manual workflow of:
> Vendor documents → Excel cleanup → normalization → comparison → spreadsheet analysis → sourcing decision
with:
> Vendor documents → AI extraction → normalization → validation → comparison → AI analysis → sourcing decision
The product must prioritize **trust, transparency, traceability, and decision quality**, not merely visual presentation.
---
# 2. Problem Statement
Procurement buyers send an RFx to multiple vendors and receive responses in different formats.
Vendor responses may contain:
* Excel spreadsheets
* PDFs
* Word documents
* Images/photos
* Email-like text
* Different currencies
* Different units
* Missing line items
* Discounts
* Freight charges
* Commercial terms
* Questionnaire responses
* Ambiguous or low-confidence information
The buyer currently has to manually interpret these responses, transfer information into spreadsheets, normalize values, compare vendors, and repeatedly modify spreadsheet formulas when someone asks a new sourcing question.
The result is a slow, error-prone workflow.
The product must reduce this work from **days to minutes** while maintaining enough transparency and evidence for a buyer to trust the output.
---
# 3. Product Goal
Enable a procurement buyer to go from:
**RFx created → vendor responses received → normalized comparison → sourcing analysis → award recommendation**
without manually constructing and maintaining a quote-comparison spreadsheet.
---
# 4. Primary User
## Category Procurement Buyer
The primary user is responsible for evaluating supplier responses and making or recommending sourcing decisions.
### User needs
The buyer needs to:
1. Create an RFx.
2. Collect vendor responses.
3. Understand what each vendor actually quoted.
4. Compare vendors fairly.
5. Identify missing or suspicious information.
6. Apply constraints such as quality qualification.
7. Ask scenario-based questions.
8. Understand why the AI reached a conclusion.
9. Make a sourcing decision that can be defended to stakeholders.
---
# 5. Jobs To Be Done
### Job 1 — Create
> "Help me create an RFx quickly and accurately."
### Job 2 — Understand
> "Turn whatever vendors send me into structured, comparable information."
### Job 3 — Analyze
> "Let me ask sourcing questions without rebuilding spreadsheets."
### Job 4 — Decide
> "Help me make a decision I can confidently explain and defend."
---
# 6. Product Scope
The prototype contains six major capabilities:
1. AI-assisted RFx creation
2. Vendor response ingestion
3. AI extraction and normalization
4. Validation and exception handling
5. Quote comparison workspace
6. AI procurement analysis/copilot
---
# 7. End-to-End User Journey
```text
Buyer
  ↓
Create RFx
  ↓
30 line items
  ↓
Send/collect vendor responses
  ↓
5 vendor responses
  ↓
AI processes responses
  ↓
Extract structured information
  ↓
Normalize units/currency
  ↓
Validate extraction
  ↓
Flag exceptions
  ↓
Comparison workspace
  ↓
Buyer asks natural-language questions
  ↓
AI calculates/analyzes
  ↓
Buyer reviews evidence
  ↓
Award recommendation
```
---
# 8. Procurement Scenario
## Category
Corrugated Packaging
## RFx
**Corrugated Packaging — FY27 Sourcing Event**
## Number of line items
30
## Number of vendors
5
## Base comparison currency
INR
## Vendor response formats
Each vendor intentionally uses a different format.
---
# 9. RFx Dataset
The RFx contains 30 line items.
|  # | Item                           | Specification  | Quantity | Unit   |
| -: | ------------------------------ | -------------- | -------: | ------ |
|  1 | 5-Ply Corrugated Box – Small   | 300×200×150 mm |   10,000 | pcs    |
|  2 | 5-Ply Corrugated Box – Medium  | 400×300×250 mm |    8,000 | pcs    |
|  3 | 5-Ply Corrugated Box – Large   | 600×400×400 mm |    5,000 | pcs    |
|  4 | 3-Ply Corrugated Box – Small   | 250×180×120 mm |   12,000 | pcs    |
|  5 | 3-Ply Corrugated Box – Medium  | 350×250×200 mm |   10,000 | pcs    |
|  6 | 3-Ply Corrugated Box – Large   | 500×350×300 mm |    6,000 | pcs    |
|  7 | Die-Cut Box – Type A           | Custom die-cut |    4,000 | pcs    |
|  8 | Die-Cut Box – Type B           | Custom die-cut |    3,500 | pcs    |
|  9 | Corrugated Sheet – Small       | 500×400 mm     |    5,000 | sheets |
| 10 | Corrugated Sheet – Large       | 1000×800 mm    |    3,000 | sheets |
| 11 | 5-Ply Corrugated Roll          | 1200 mm width  |    1,500 | kg     |
| 12 | 3-Ply Corrugated Roll          | 1000 mm width  |    1,000 | kg     |
| 13 | Kraft Paper Tape               | 48 mm          |    5,000 | rolls  |
| 14 | BOPP Packaging Tape            | 48 mm          |   10,000 | rolls  |
| 15 | Printed Packaging Tape         | Custom print   |    3,000 | rolls  |
| 16 | Paper Labels                   | 100×50 mm      |   50,000 | pcs    |
| 17 | Fragile Labels                 | Standard       |   25,000 | pcs    |
| 18 | Barcode Labels                 | Custom barcode |   30,000 | pcs    |
| 19 | Edge Protectors – Small        | Standard       |   10,000 | pcs    |
| 20 | Edge Protectors – Large        | Standard       |    8,000 | pcs    |
| 21 | Corrugated Partition – 6 Cell  | Custom         |    5,000 | pcs    |
| 22 | Corrugated Partition – 12 Cell | Custom         |    4,000 | pcs    |
| 23 | Paper Void Fill                | Recyclable     |    2,000 | kg     |
| 24 | Kraft Paper Sheets             | 500×500 mm     |    5,000 | sheets |
| 25 | Stretch Film                   | 500 mm         |    2,000 | rolls  |
| 26 | Bubble Wrap                    | 1 m width      |    1,500 | rolls  |
| 27 | PP Strapping                   | 12 mm          |    3,000 | rolls  |
| 28 | PET Strapping                  | 16 mm          |    2,000 | rolls  |
| 29 | Wooden Pallet                  | 1200×1000 mm   |    1,000 | pcs    |
| 30 | Corrugated Pallet              | 1200×1000 mm   |    1,500 | pcs    |
---
# 10. Vendor Dataset
The prototype must contain five vendors with intentionally different response formats.
## Vendor A — Clean Excel
Format:
* XLSX
Characteristics:
* 30/30 items quoted
* INR
* Standard units
* Clear prices
* Complete questionnaire
* Supporting specification document
Purpose:
Provide the baseline clean response.
---
## Vendor B — PDF
Format:
* PDF
Characteristics:
* 30/30 items
* INR
* Some prices use a different unit
* Discount appears in a footnote
* Freight is quoted separately
* Some item names differ slightly from RFx terminology
Purpose:
Test extraction, normalization, and commercial-term interpretation.
---
## Vendor C — Word Document
Format:
* DOCX
Characteristics:
* Prices in USD
* Some prices quoted per 100 units
* Freight excluded
* 30/30 items
Purpose:
Test currency and quantity normalization.
---
## Vendor D — Image
Format:
* JPG/PNG
Characteristics:
* Photograph of a printed quotation
* Angled image
* Some difficult-to-read text
* Handwritten adjustment
* Only 27/30 items quoted
Purpose:
Test OCR/extraction confidence and missing-item detection.
---
## Vendor E — Email/Text
Format:
* Email-style text
Characteristics:
* Only 27/30 clearly quoted
* Informal language
* "Rest same as last year"
* Freight extra
* Some commercial terms missing
Purpose:
Test unstructured natural-language extraction and ambiguity.
---
# 11. Vendor Questionnaire
Each vendor has questionnaire responses.
Questions:
1. Is the vendor ISO 9001 certified?
2. Does the vendor have at least 3 years of packaging experience?
3. Can the vendor provide samples before production?
4. What is the maximum standard lead time?
5. Can the vendor support the required monthly volume?
6. Does the supplied material meet the required GSM/specification?
7. Can the vendor provide batch-level quality documentation?
8. Can the vendor support emergency orders?
9. What payment terms does the vendor require?
10. Has the vendor supplied similar enterprise customers?
The questionnaire must be usable as a constraint in AI analysis.
Example:
> "Only consider vendors that passed the quality questionnaire."
---
# 12. Screen 1 — RFx Creation
## Purpose
Allow the buyer to create the sourcing event.
## UI
Fields:
* RFx name
* Category
* Required-by date
* Currency
* Description
* Line items
* Quantity
* Unit
* Specification
### AI assistance
Provide an AI input:
> "Describe what you're buying..."
Example:
> "We need corrugated packaging for our Hyderabad fulfillment operations."
AI generates a draft RFx.
The buyer can review/edit before proceeding.
### Primary CTA
**Create RFx**
---
# 13. Screen 2 — Vendor Responses
Display:
```text
Corrugated Packaging — FY27 Sourcing Event
5 Vendors
Vendor A     ✓ Processed
Vendor B     ✓ Processed
Vendor C     ✓ Processed
Vendor D     ⚠ Review Required
Vendor E     ⚠ Review Required
```
Each vendor should show:
* Response status
* Format
* Number of items found
* Number of items missing
* Extraction confidence
* Validation status
Example:
```text
Vendor D
27 / 30 items found
⚠ 3 items missing
⚠ 2 low-confidence values
✓ 25 values high confidence
```
---
# 14. Screen 3 — AI Extraction & Validation
For each vendor show:
### Extraction
* Items extracted
* Prices extracted
* Units extracted
* Currency detected
* Commercial terms
* Questionnaire responses
### Confidence
Example:
```text
Price extraction       96%
Unit extraction        93%
Currency detection    99%
Commercial terms       81%
```
### Exceptions
Example:
```text
⚠ 3 items not quoted
⚠ Freight appears to be excluded
⚠ Item #16 price has low extraction confidence
⚠ Vendor quoted per 100 units instead of per unit
```
---
# 15. Source Traceability
Every important extracted value must be traceable back to its source.
Example:
```text
Vendor B
Medium Corrugated Box
Normalized price:
₹49 / piece
Original:
₹4,900 / 100 pieces
Source:
Vendor B Quote.pdf
Page 2
Confidence:
97%
```
The user should be able to inspect the original source context.
### Critical rule
The AI must **never silently invent missing information**.
If the source is unclear:
> Flag it.
Do not guess.
---
# 16. Screen 4 — Comparison Workspace
This is the primary product screen.
Display all 30 RFx items against the five vendors.
Example:
| Item       |    Qty | Vendor A | Vendor B | Vendor C | Vendor D | Vendor E |
| ---------- | -----: | -------: | -------: | -------: | -------: | -------: |
| Small Box  | 10,000 |      ₹42 |      ₹40 |      ₹43 |        — |      ₹41 |
| Medium Box |  8,000 |      ₹51 |      ₹49 |      ₹52 |      ₹48 |      ₹50 |
| Tape       |  5,000 |      ₹10 |      ₹12 |       ₹9 |      ₹11 |      ₹10 |
Each value should be clickable.
Clicking a value opens:
* Original value
* Normalized value
* Unit conversion
* Currency conversion
* Source
* Confidence
* Adjustments
* Notes
---
# 17. Evaluated Cost
The product must distinguish between:
### Quoted price
What the vendor explicitly quoted.
### Evaluated price
The comparable cost after applicable normalization/adjustments.
For example:
```text
Quoted:
₹4,000 / 100 kg
Normalized:
₹40 / kg
Freight:
₹3 / kg
Evaluated:
₹43 / kg
```
If a cost cannot confidently be calculated:
> **Not enough information**
Do not assume zero.
---
# 18. Exception System
The comparison workspace must visibly flag:
* Missing item
* Different unit
* Different currency
* Low-confidence extraction
* Missing freight
* Missing tax
* Discount
* MOQ
* Lead-time concern
* Quality failure
* Ambiguous value
The buyer should be able to filter:
> **Show only exceptions**
---
# 19. Screen 5 — AI Procurement Copilot
Provide a natural-language input:
> **Ask anything about these quotes...**
The AI should support questions such as:
### Basic
> "Who is cheapest overall?"
### Line-level
> "Who is cheapest for each item?"
### Split-award
> "What if we split the order by the cheapest vendor for each line?"
### Constraint-based
> "Only consider vendors who passed the quality questionnaire."
### Exception
> "Which vendors didn't quote all items?"
### Risk
> "What are the biggest risks with Vendor B?"
### Commercial
> "Which vendor has the best payment terms?"
### Scenario
> "If Vendor B gives us a 5% additional discount, does it become the cheapest overall?"
---
# 20. AI Response Requirements
AI responses must be:
### Grounded
Use only available RFx/vendor data.
### Explainable
Explain how the answer was calculated.
### Traceable
Link important claims to source data.
### Uncertainty-aware
If the information is incomplete, explicitly say so.
### Deterministic where possible
For calculations such as totals, rankings, and price comparisons, use structured data/calculation logic rather than relying on free-form LLM arithmetic.
---
# 21. Example AI Answer
User:
> "What if we split the order by the cheapest vendor for each line, but only among vendors who passed quality?"
AI:
```text
Split award recommendation
Eligible vendors:
✓ Vendor A
✓ Vendor C
✗ Vendor B — failed quality criterion
✗ Vendor D — incomplete response
✓ Vendor E
Recommended allocation:
Vendor A     11 items
Vendor C     14 items
Vendor E      5 items
Estimated total:
₹XX,XX,XXX
Estimated savings vs. Vendor A:
₹X,XX,XXX
Important:
3 items have incomplete commercial information.
The recommendation excludes those items from the savings calculation.
View calculation →
```
The exact numbers should be generated from the actual dataset.
---
# 22. Screen 6 — Award Recommendation
The final stage should summarize:
### Recommended strategy
* Single vendor
* Split award
* Manual review required
### Summary
* Total evaluated cost
* Savings
* Number of awarded items
* Vendors selected
* Exceptions
* Quality constraints
* Confidence
### Evidence
Show why the recommendation was made.
Example:
> "Vendor C is recommended for 14 line items because it provides the lowest evaluated cost among quality-qualified vendors."
---
# 23. Trust Model
Trust is a first-class product feature.
Every AI-generated recommendation should answer:
### What?
What is the recommendation?
### Why?
Why was it recommended?
### Based on what?
Which data was used?
### How confident?
What information is uncertain?
### What should the buyer verify?
What requires human review?
---
# 24. AI Architecture
Do NOT implement one giant prompt.
Use a staged pipeline:
```text
Vendor Document
      ↓
Document Classification
      ↓
Extraction
      ↓
Structured Vendor Data
      ↓
Normalization
      ↓
Validation
      ↓
Confidence / Exceptions
      ↓
Comparison Dataset
      ↓
Deterministic Calculations
      ↓
AI Analysis
      ↓
Buyer Answer
```
---
# 25. Structured Data Model
Each extracted quote should conceptually contain:
```json
{
  "vendor": "Vendor A",
  "lineItemId": 1,
  "sourceValue": 42,
  "sourceCurrency": "INR",
  "sourceUnit": "piece",
  "normalizedValue": 42,
  "normalizedCurrency": "INR",
  "normalizedUnit": "piece",
  "discount": null,
  "freight": null,
  "tax": null,
  "confidence": 0.97,
  "sourceReference": {
    "document": "vendor_a_quote.xlsx",
    "location": "Sheet1!B12"
  },
  "status": "verified"
}
```
The implementation can modify the exact schema, but the concepts must remain.
---
# 26. Confidence Rules
Use confidence levels:
### High
90–100%
### Medium
70–89%
### Low
Below 70%
Low-confidence values must be visually flagged.
The AI must never present a low-confidence extraction as unquestioned fact.
---
# 27. Missing Data Rules
If a vendor doesn't quote an item:
Display:
> **Not quoted**
NOT:
> ₹0
If freight is unknown:
Display:
> **Freight not specified**
NOT:
> ₹0 freight
If tax is unknown:
Display:
> **Tax not specified**
Do not invent values.
---
# 28. Currency Rules
The prototype uses INR as the comparison currency.
If a vendor quotes in USD:
Store both:
```text
Original:
USD 0.025
Normalized:
₹X.XX
```
Also display:
* Exchange rate used
* Conversion date/time
* Source/method if available
The system must not hide the original currency.
---
# 29. Unit Normalization
Where conversion is deterministic, normalize automatically.
Example:
```text
₹4,000 / 100 pieces
↓
₹40 / piece
```
If conversion requires an assumption that is not supported by the source:
> Flag for buyer review.
Never invent conversion factors.
---
# 30. Core Product Metrics
## Primary product outcome
### Time to trusted sourcing decision
Measure:
> Vendor responses received → buyer reaches a defensible decision.
The goal is to move the workflow from days toward minutes.
---
## Supporting metrics
### Extraction accuracy
Percentage of extracted fields that are correct.
### Normalization accuracy
Percentage of normalized values correctly converted.
### Human correction rate
Percentage of extracted fields requiring buyer correction.
### AI answer accuracy
Percentage of AI answers correctly supported by underlying data.
### Exception detection rate
Percentage of known dataset exceptions correctly identified.
### Time to comparison
Time between response upload and usable comparison.
### Decision time
Time from processed responses to sourcing decision.
### Adoption
Percentage of RFx events processed through the product.
---
# 31. Guardrail Metrics
The system must monitor:
### Unsupported recommendation rate
How frequently does the AI recommend something without sufficient evidence?
### False-confidence rate
How frequently does the system present uncertain information as certain?
### Calculation error rate
How frequently are totals/rankings incorrect?
### Unreviewed low-confidence decisions
How often does a buyer proceed despite unresolved critical uncertainty?
---
# 32. Success Criteria
The prototype is successful if a buyer can:
1. Create an RFx.
2. Process five heterogeneous vendor responses.
3. Extract vendor data.
4. Identify missing information.
5. Normalize currencies/units.
6. Compare vendors.
7. Apply quality constraints.
8. Ask natural-language sourcing questions.
9. Receive calculations grounded in the dataset.
10. Trace important values back to their source.
11. Understand uncertainty.
12. Arrive at a defensible award recommendation.
---
# 33. Edge Cases
The prototype must intentionally test:
1. Vendor quotes only 27/30 items.
2. Vendor uses USD.
3. Vendor uses different units.
4. Vendor includes discount in a footnote.
5. Freight is excluded.
6. Photograph contains ambiguous text.
7. Vendor has incomplete questionnaire.
8. Vendor fails quality requirement.
9. Two vendors use different names for the same item.
10. Source contains insufficient information for normalization.
11. AI extraction confidence is low.
12. Buyer asks a question whose answer cannot be determined from available data.
For unsupported questions, the AI must say:
> "I don't have enough information to determine that."
---
# 34. Deliberate Non-Goals
Do NOT build:
* Full ERP integration
* Production supplier onboarding
* Real email infrastructure
* Real RFx delivery infrastructure
* Payment processing
* Contract lifecycle management
* Complete procurement suite
* Complex enterprise permissions
* Production-grade authentication
* Full supplier relationship management
The prototype should focus on:
> **Quote ingestion → trustworthy comparison → AI-assisted sourcing decision.**
---
# 35. UX Principles
## Principle 1 — Data over decoration
The comparison data should be the primary visual focus.
## Principle 2 — Trust over magic
Don't hide uncertainty.
## Principle 3 — Explain important decisions
Recommendations need reasoning.
## Principle 4 — Show the source
Important extracted values should be traceable.
## Principle 5 — AI assists; buyer decides
The buyer remains in control.
## Principle 6 — Exceptions are visible
Never hide missing or ambiguous data.
## Principle 7 — Natural language replaces spreadsheet manipulation
The buyer should be able to ask:
> "What if..."
instead of manually rebuilding formulas.
---
# 36. What We Deliberately Leave Out
We are intentionally not attempting to build the entire procurement lifecycle.
We are focusing on the highest-value workflow:
> **Messy vendor responses → trustworthy comparison → sourcing analysis → decision.**
This keeps the prototype focused and allows us to demonstrate depth rather than breadth.
---
# 37. Technical Requirements
## Frontend
Recommended:
* React
* TypeScript
* Modern component library
* Responsive desktop-first UI
## Backend
Use whichever backend is fastest and most reliable for the prototype.
Possible:
* Node.js
* Python
## AI
Use an LLM for:
* RFx generation
* Document understanding
* Extraction assistance
* Natural-language analysis
Use deterministic code for:
* Currency calculations
* Unit conversions where deterministic
* Totals
* Rankings
* Savings calculations
* Constraint filtering
## Storage
Use a simple structured database or persistent JSON/database layer appropriate for the prototype.
---
# 38. Prototype Requirements
The prototype must be genuinely functional.
Do NOT create fake UI that only displays predetermined answers.
At minimum:
* Vendor documents must be ingestible.
* Extraction must actually occur.
* Structured data must drive the comparison table.
* AI questions must operate against the structured dataset.
* Calculations must use actual underlying data.
* Exceptions must be generated from the dataset.
* Recommendations must be explainable.
Mock/stub infrastructure is acceptable where it does not compromise the core product demonstration.
---
# 39. Demo Scenario
The live demo should follow this story:
### Step 1
Create:
> Corrugated Packaging — FY27 Sourcing Event
### Step 2
Show 30 required line items.
### Step 3
Show five vendors.
### Step 4
Upload/ingest their different response formats.
### Step 5
Show AI extraction.
### Step 6
Show Vendor D has:
> 27/30 items
and low-confidence values.
### Step 7
Open comparison workspace.
### Step 8
Click an extracted price and show source traceability.
### Step 9
Ask:
> "Who is cheapest overall?"
### Step 10
Ask:
> "What if we split the order by the cheapest vendor for each line?"
### Step 11
Ask:
> "Only consider vendors who passed the quality questionnaire."
### Step 12
Show final recommendation.
### Step 13
Show exceptions and explain what the buyer still needs to verify.
---
# 40. Demo Success
At the end of the demo, the interviewer should believe:
> "This product can take the messy information procurement teams receive from vendors and turn it into a trustworthy decision-making workflow."
They should NOT leave thinking:
> "This is just a nice-looking AI dashboard."
---
# 41. AI Coding Agent Instructions
When implementing this PRD:
1. Do not invent additional major product features.
2. Do not remove the trust/traceability requirements.
3. Do not fake AI reasoning.
4. Do not hard-code final recommendations.
5. Keep deterministic calculations outside the LLM where possible.
6. Make the comparison workspace the core screen.
7. Make exceptions highly visible.
8. Make source traceability accessible.
9. Use realistic enterprise UX.
10. Optimize for a live interview demo.
11. Keep the architecture simple enough to understand and explain.
12. Prioritize functional depth over feature breadth.
---
# 42. Definition of Done
The prototype is ready for the Aerchain interview when:
### RFx
* [ ] RFx can be created
* [ ] 30 line items exist
* [ ] AI-assisted creation works
### Vendor ingestion
* [ ] 5 vendors exist
* [ ] Different response formats are represented
* [ ] Vendor data is extracted
### Normalization
* [ ] Currency normalization works
* [ ] Unit normalization works
* [ ] Original values remain visible
### Validation
* [ ] Missing items detected
* [ ] Low-confidence values flagged
* [ ] Ambiguous information flagged
* [ ] Commercial exceptions visible
### Comparison
* [ ] 30-line comparison table works
* [ ] Vendor comparison works
* [ ] Evaluated cost is calculated
* [ ] Source evidence can be inspected
### AI Copilot
* [ ] Natural-language questions work
* [ ] Answers use underlying data
* [ ] Scenario analysis works
* [ ] Quality constraints work
* [ ] AI explains recommendations
### Trust
* [ ] Source traceability
* [ ] Confidence
* [ ] Uncertainty
* [ ] No fabricated values
### Demo
* [ ] Complete end-to-end flow works
* [ ] No broken core interactions
* [ ] Prototype can be demonstrated live
* [ ] Key product decisions can be explained
---
# 43. Product Principle
The single most important principle for this prototype:
> **Don't optimize for producing an answer. Optimize for producing an answer the procurement buyer can trust.**
The product wins when it changes the buyer's workflow from:
> **"Let me open five spreadsheets and figure this out."**
to:
> **"Let me ask the system."**
while still giving the buyer enough evidence to confidently act.
