# Parts K through O — Rules, calendar, roadmap, automation

## Part K — Adaptation rules

Use the first matching row. Do the action the same day you see the number. Do not stack three changes at once. One change, then a week, so you know what moved.

| If you see this | Do this |
| --- | --- |
| CPC above half of max CPC for 7 days, and conversion under 8% | Cut bids 20%. Add negative exact terms from the search-term report that spent and did not sell. Do not raise the budget. |
| Conversion under 5% after 200 clicks | Pause scale-up. Replace the main image or the first bullet. Recheck the price against the gate. Leave the campaign paused until the new image has been live 48 hours, then restart at the old budget, not a higher one. |
| TACOS above your calculated maximum | Cut the daily budget in half today. |
| Returns above 8% after 20 units | Stop printing the batch. Read every reason. If the reason is fit, go to the fit row below. |
| Returns above 15%, or 3 fit complaints in 14 days | Stop selling that version. Pull FBM stock. Create a removal order for FBA stock if it is already there. |
| A competitor cuts price | Re-run the calculator at their price. If cash profit per printer hour would fall under $15, do not match. Improve the proof (fit photo, measurement) or exit the model. |
| A week of orders needs more hours than the printer can run | Raise price 10%. If the next week is still over capacity and the gate still passes, buy one more printer of the same model. |
| A SKU hits 100 units in a month | Write the one-page process while you still remember it. Get three mold quotes. Do not order a tool. File a trademark only if the brand is already on 50 packages. |
| A SKU hits 500 units in a month | Run crossover = mold quote ÷ (your cash COGS − their part price). Order a tool only if crossover is inside the units your last 60 days would produce, and two quotes agree on the shape of the number. |
| Injection molding looks cheaper on a blog | Ignore the blog. Use your quote and your COGS. |
| Buyers ask for another model | Add a sheet row. Prototype it only if it passes the gates and the current SKU is not in a KILL or IMPROVE state. |
| Another seller copies you | Save the listing. If your trademark is filed or registered, use Brand Registry's report tool for the copying of your brand or your listing content. A compatible part of their own is competition, not theft. Answer with better fit proof. |
| An IP complaint arrives | Do not relist with a tweaked title the same hour. Read the complaint. If it is your use of their brand, edit to a truthful compatibility line. If it is a patent, stop that SKU until someone who reads claims says you are clear. |
| Print failure rate above 8% PETG or 12% ASA for a week | Stop saleable production. Dry filament, clean the plate, slow the outer wall. Ship nothing from a bad plate. |
| A review says the part got soft, cracked in the sun, or went in a dishwasher | That is a material error. Stop. Move the production material to ASA only after a real heat or sun test, or kill the environment claim. |
| Cash in the business account would not cover 30 days of filament, postage, and the Amazon plan | Do not buy a printer, a mold, or an ad budget increase. |

### Decision tree

```
New information arrives
        |
        v
Is someone at risk of injury, or is there an IP complaint you do not understand?
        | yes → stop the SKU, get help, do not "tweak and relist"
        | no
        v
Did the number break a kill line (returns, hour rate, failure rate)?
        | yes → KILL or IMPROVE per the table. One change.
        | no
        v
Is demand above what you can print?
        | yes → price +10% first, printer second
        | no
        v
Is the SKU through 20 clean sales and still clearing $25/hour?
        | yes → FBA and ads are allowed, still on their own gates
        | no → keep printing to order and fill the research sheet
```

---

## Part L — Daily, weekly, monthly

### Daily (20 minutes on days you have orders or a printer running)

- Printer: finished parts into QC, failures into the fail count, next job started only if it is the current version.
- Orders: print today's orders first, then batch stock.
- Messages: answer with the measurement and the ban sentence. If they have the wrong shaft, tell them to return it. Do not talk them into forcing it.
- Ads, if on: spend versus the daily cap. A campaign that spent the cap before noon for three days gets a lower bid, not a higher cap, unless conversion is above your target and TACOS is under half of the maximum.
- Nothing else. No new product ideas in the daily block.

### Weekly (Friday, 90 minutes)

- Research recipe, Part D, if it is Tuesday you already did it. Friday is the numbers, not a second research day. If you skipped Tuesday, do 45 minutes of research and 45 of numbers. Do not skip the numbers.
- SKUs: kill / improve / scale using Part K.
- Production: grams used, fail rate, printer hours, hours that were sold work versus samples.
- Inventory: on hand, days of cover, anything over 60 days gets a stop-print.
- Cash: revenue, fees, postage, refunds, filament bought, contribution.
- One decision written at the top of the sheet in a sentence. "v01 knob stays print-to-order. Do not buy ASA this week."

### Monthly (first Monday, 2 hours)

For each live SKU, one label: kill, improve, expand, outsource, or mold-watch.

- Kill: failed a gate and a revision will not fix the price or the safety issue.
- Improve: a new version is in CAD with a reason from returns.
- Expand: 30 clean sales and a second measured variant is allowed onto the sheet's TEST list.
- Outsource: you are the bottleneck and the process is written. First outsource is a freelance CAD revision or a print operator for a gate-passing SKU, not a virtual assistant to "find products."
- Mold-watch: 100 units in the month. Quotes requested. No deposit unless the 500-unit rule is also met.

### KPI dashboard

Keep these in the sheet. Leave a cell blank when you do not have the data. Do not write zero for "unknown."

| KPI | Formula | How to read it |
| --- | --- | --- |
| Revenue | Sum of order totals | Vanity if contribution is negative |
| Units | Shipped units | Separate by SKU |
| Average selling price | Revenue ÷ units | A falling ASP is the competitor-price rule |
| Contribution margin | Cash contribution ÷ revenue | After fees, postage, COGS, ads, return allowance |
| TACOS | Ad spend ÷ revenue | Must sit under your calculated max |
| Conversion | Orders ÷ sessions, from Amazon business reports | Under 5% after real traffic is a listing problem |
| Returns | Refunded units ÷ shipped units | 8% watch, 15% stop |
| Defect rate | QC fails ÷ parts started | PETG watch at 8%, ASA at 12% |
| Printer utilization | Print hours ÷ hours you were willing to run | High utilization on a bad SKU is not success |
| Print failure rate | Failed prints ÷ prints started | Same thresholds as defects |
| Inventory units | Count | By version. Never mix v01 and v02 |
| Stockouts | Orders you could not accept or shipped late | A stockout on a proven SKU is the reorder point being wrong |
| Days of inventory | On hand ÷ daily sales | 14–45 is the band. Over 60, stop printing |
| Profit per printer hour | Cash contribution ÷ print hours | Scale line is $25. Kill line is $15 |
| Profit per gram | Cash contribution ÷ grams | A rising number means you are selling small, high-price parts |
| Profit per SKU | Cash contribution by SKU | One SKU should carry the month until 30 sales |
| New products launched | Count | More than one per month in the first quarter is a warning |
| Products killed | Count | A kill is a success if it happened before a printer purchase or before FBA |

---

## Part M — The first 90 days

Each week ends with a thing you can hold or a sentence on the sheet. "Researched products" is not an output.

**Week 1 — Records and the first kill.** Sheet created. Calipers purchased. 30 rows started. Dishwasher-clip class ideas priced against live listings and killed or held with the price written down. Output: a sheet with at least 15 rows and 5 hard kills.

**Week 2 — Evidence.** 20 eBay sold rows for knobs. 10 Amazon listings. OEM page status. Patent queries written down. Output: one TEST row named MODEL YOU SELECT, or a written note that no row cleared the price gate. Both are acceptable outputs. A forced winner is not.

**Week 3 — Donor and, if the gate passed, the printer.** Donor ordered in week 2 should arrive. Measure it. If it matches, order one enclosed printer, one PETG spool, nozzles, and mailers. If it does not match, do not order the printer yet unless a second TEST row already has a donor in hand. Output: a dimensioned sketch, or a kill note.

**Week 4 — Version 1.** CAD from the sketch. One fit print. Fit test. Photo. Output: v01 or v02 in your hand, labeled not for sale, with grams and minutes written down.

**Week 5 — Economics and paper.** Live postage quote. Calculator. LLC filed or the state packet filled in. EIN. Insurance quote requested. Output: a go or a kill on the economics gate, and the quote request sent.

**Week 6 — Listing.** Brand name searched on USPTO. Slip printed. Photos. eBay live. Amazon account started if the prototype fits and the LLC bank account exists. Output: one live listing, print to order, quantity zero on the shelf.

**Week 7 — The quiet week.** Answer messages. Do not add a SKU. Print only orders. Output: a Friday KPI row, even if every sales cell is zero.

**Week 8 — The second look.** If there are no sales, change the main photo and the first bullet once. Start the snowblower sold-listing pass only as research, no second listing. Output: either the first orders, or one revised photo and a note.

**Week 9 — Batch rule.** If two orders happened inside seven days, print 10. QC against the donor. Output: a bin of 10, or a note that the batch rule has not triggered.

**Week 10 — Returns, if any.** Tag reasons. A fit problem becomes v02 and a stop on v01. Output: a version decision.

**Week 11 — Ads gate.** If you have 10 sales and returns are at or under 8%, upgrade to Professional and start the two campaigns at $10 a day each. If you do not have 10 sales, do not upgrade yet. Output: campaigns, or a sentence that says why they are still off.

**Week 12 — The day-90 decision.** One page: kill, improve, or scale, using the rules. Second SKU still not live unless SKU one has 30 sales. Output: the page, plus the next week's single action.

**Week 13 (the first week of the next quarter, so day 90 does not trail off).** FBA only if the 20-sale and 8% rules are met. Otherwise stay FBM on purpose.

---

## Part N — One year, as scenarios

These are not forecasts. Nobody in this research verified a monthly sales volume. The ranges exist so you can recognize which world you are in and spend accordingly.

| Month | Research | Prototypes | Live SKUs | Printers | What "on track" means |
| --- | --- | --- | --- | --- | --- |
| 1 | 30 rows, most killed | 0 or 1 fit check | 0 | 0 until the gate, then 1 | You have a sketch or a kill. Spend under the first $500. |
| 2 | Sheet still growing | 1 | 1 listing | 1 | Print to order. Revenue may be $0. A few hundred dollars of revenue is a good month, not a plan you borrow against. |
| 3 | Second idea researched, not listed unless the rule allows | 1–2 | 1 | 1 | Day-90 decision written. |
| 6 | 60+ rows cumulative | 2–4, most not live | 1–3 | 1, or 2 only if the utilization rule hit | You know your real return rate and your real postage. |
| 9 | Variants only from buyer requests that pass the gate | — | 2–5 if earlier SKUs earned them | 1–2 | A mold quote exists only if a SKU did 100 units in a month. |
| 12 | The sheet is a library | — | A handful, not 30 | 2–4 only in the good scenario | You can hire or you can stay a one-printer shop on purpose. |

**Stop scenario.** The first three TEST rows die on price, fit, or returns. You own one printer and calipers. You stop listing and you do not buy printer two. The printer is now a tool you already paid for, not a reason to launch a bad SKU. Cash loss is the equipment, the filament, and the fees on the units you did sell.

**Base scenario.** One SKU sells a few units a week by month 6. Revenue on the order of $1,000 to $3,000 in a good month by month 12 is a plausible shape for a single knob at about $28 and a few dozen units a month. Contribution might be a few hundred to around a thousand dollars in that month before you pay yourself a wage, and it might be less. This is a side shop. Treat it that way. Do not lease space.

**Good scenario.** Two or three SKUs each clear the hour gate and together reach something like 150–400 units a month by month 12. At roughly $25 and a cash contribution near the "average" example, monthly contribution can land in the low thousands before owner labor. This requires demand this manual did not verify. If it happens, it will show up in your orders first. Staffing is still one person plus a freelance designer. Outsourcing print labor comes only after the process sheet exists.

**Excellent shape, not a target.** Two printers busy on parts that look like the excellent example (about $50 cash profit per printer hour) can produce a few thousand dollars of contribution a month if the orders are real. The missing ingredient is the orders. Do not hire, mold, or rent on the excellent shape until your own order report has matched it for 60 days.

Staffing, outsourcing, automation: none in months 1–3 except the economics script and the sheet. A freelance CAD designer at the third failed fit. A second printer only on the utilization rule. A molder only on the crossover rule.

---

## Part O — Automate the company

For each recurring task the answer is already chosen. Revisit it when the task has happened ten times.

| Task | AI | Software | Batch | Outsource | Eliminate |
| --- | --- | --- | --- | --- | --- |
| Market research | An AI can turn 20 reviews you paste into themes. It must not invent sales. | The sheet. Keepa later for price history. | Tuesday block only | No | Extra research days |
| Review mining | Paste the text, ask for repeated complaints and the buyer's nouns. | Amazon's review sort | 20 at a time | No | Reading all 2,000 reviews |
| Opportunity scoring | The calculator scores economics. You score IP and safety. | `unit_economics.py` | Friday | No | Scoring in your head |
| Competitor tracking | No | Keepa price watch after you have a live SKU | Weekly glance | No | Daily price checking |
| Keyword monitoring | AI can cluster a search-term report you export | Amazon's report | Weekly | No | Paid keyword tools before $5,000 months |
| Listing optimization | AI drafts bullets from your measurements. You delete any claim you have not verified. | Seller Central | One revision per week maximum | A designer for photos only after revenue | Endless rewriting |
| Inventory forecasting | No, not at this volume | The reorder formula | Friday | No | Apps before 5 SKUs |
| Customer messages | AI drafts a reply from the slip text. You send it. | Templates for "measure your shaft" | — | No | Free-form essays |
| New product ideas | AI may propose queries. It may not declare a winner. | The sheet | Tuesday | No | Idea files outside the sheet |
| Financial reporting | No | The Friday sheet. Export orders. | Weekly | A bookkeeper after the monthly contribution is real and steady | Desktop software before 50 orders |

**Stays human.** Kill or scale. Anything safety-related. Anything that might be a patent or a trademark. The ad budget above the written cap. A mold deposit. A second Amazon account (do not open one). The sentence on the package about what the part is not. The final look at a fit photo before it goes in the listing.

**A practical AI workflow, not a pile of agents.**

1. Research helper: you paste 20 reviews and the sold-price list. It returns themes, nouns, and a reminder of which gates it cannot score. You type the score.
2. Listing helper: you paste the CAD brief and the ban sentence. It drafts a title and five bullets. You remove every model number you did not fit.
3. Friday helper: you paste the KPI row. It points at the first Part K rule that matches. You make the decision.
4. Message helper: you paste the buyer message and your slip. It drafts a short reply. You send it from the marketplace, not from a personal email.

That is enough automation for a one-printer company. A larger agent stack before you have 30 sales will automate the production of untested ideas.
