PROCUREAI / AERCHAIN SYNTHETIC TEST PACK
All names, GSTINs, prices and history are synthetic.

CURRENT RFX: RFX-2026-091
30 lines; 5 vendor responses; Hyderabad fulfillment; required by 2027-01-15.

FORMAT TESTS
V001 PDF — complete INR response.
V002 DOCX — 27/30 priced; 3 missing; one price basis is per 100 pieces.
V003 XLSX — first 10 lines USD, remaining INR; basis anomalies on first lines.
V004 TXT — all prices present but quality questionnaire intentionally blank; freight unspecified.
V005 JPG — angled/rotated photo; 2 prices missing.

EXPECTED BEHAVIOR
- Missing price is NOT zero.
- Incomplete vendor is clearly marked and not treated as fully comparable.
- USD is converted only with explicit FX rate/date/source.
- Unit basis is normalized before comparison.
- Unanswered quality is flagged, not interpreted as No.
- Pending vendor verification is surfaced.
- Historical procurement evidence is available for V001, V002 and V005.
- Freight not specified must not silently become zero.
- Award/savings derivation should be deterministic and auditable.

COMPLETED PROCUREMENT HISTORY
PRC-2025-041 awarded to V001.
PRC-2025-077 awarded to V002.
PRC-2026-019 awarded to V005.

SUGGESTED QUESTIONS
1. Who is cheapest overall?
2. Who has the best comparable basket?
3. Which vendors have incomplete responses?
4. What needs human verification?
5. Should we split the award?
6. Show me the derivation for the savings.
7. Which vendors have prior procurement history?
8. Which vendors are verified and which require verification?
9. Export the comparison.
10. Generate the award memo.
