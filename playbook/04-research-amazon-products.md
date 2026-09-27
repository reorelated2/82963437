# Parts D, H, I, and J — Research, Amazon, the thirty, and one walkthrough

## Part D — The weekly research recipe

Do this every Tuesday for 90 minutes. Stop at 90. A longer session produces duplicate rows and invented confidence.

### Where you go, in this order

1. **Amazon.** amazon.com search box. No tools required.
2. **eBay sold.** ebay.com → search → Sold items → US only if you sell in the US.
3. **Google.** google.com, the query patterns below.
4. **Google Trends.** trends.google.com, United States, 12 months.
5. **Reddit.** reddit.com/search, sorted by new, last year if the filter exists, otherwise read dates yourself.
6. **YouTube.** youtube.com, sort by relevance, watch only videos where someone says they cannot buy the part. A repair video that links an OEM part is a sign the part is still sold.
7. **One forum, rotated by week.** Week A: an appliance forum or appliancepartspros.com search. Week B: a vehicle forum, and then immediately apply the safety ban (no brakes, no steering, no fuel, no airbags, no sensor brackets). Week C: a home-repair or RV forum. Week D: a lawn-equipment forum, same safety ban on kill switches and bails.
8. **Amazon reviews and questions** on the two listings you opened. Questions are the compatibility chart your buyers need.
9. **Etsy** search, only to see if a maker already sells the printable and at what price. etsy.com.
10. **Manufacturer parts catalogs.** The OEM parts site or a seller like repairclinic.com. Record the list price and whether the status says discontinued. That is availability, not sales volume.

### Search phrases

Use these as suffixes on a noun you already have (dryer, dishwasher rack, snowblower chute, closet rod, mailbox, euro hinge):

`replacement`, `broken`, `discontinued`, `does anyone make`, `can't find`, `where can I buy`, `wish there was`, `adapter`, `holder`, `mount`, `clip`, `bracket`, `replacement part`, `fits`, `compatible with`, `organizer`.

Example queries you can paste:

- `"can't find" knob dryer`
- `"discontinued" "knob" washer`
- `snowblower "chute" knob broken`
- `euro hinge stripped screw hole`
- `"replacement" mailbox flag plastic`
- `site:reddit.com dishwasher rack clip PLA`

Skip any result that is a child product, a food container, a medical device, or a safety device. Mark the row KILL in the safety column and move on. Do not "note it for later."

### How a complaint becomes a row

1. Copy the buyer's sentence into `customer problem`.
2. The words they would type into Amazon become `search phrase`. If they typed a part number, that is the phrase.
3. You do not create a product from a complaint you cannot measure. "They need a better organizer" is not a row. "The timer knob on a Kenmore dryer split and the OEM page says no longer available" is a row, after you confirm the page.
4. If ten people describe ten different machines, that is ten rows or it is nothing. Do not average them into "universal knob."

### Opportunity sheet

Use `templates/opportunity-sheet.csv`. Minimum columns:

Product, customer problem, search phrase, Amazon competitors, average price, review count, ratings, bad review themes, material, estimated grams, print time, material cost, Amazon fees, advertising assumption, estimated contribution profit, IP risk, return risk, difficulty, potential variants, opportunity score, verdict.

Fill fees and profit only after the calculator. Verdict is KILL, HOLD, TEST, or LIVE.

### Weekly quota

- 10 new rows, or 5 new rows and 5 old rows re-checked against today's prices.
- 3 patent searches on the rows closest to TEST.
- 1 donor purchased only if a row cleared the hard gates and you do not already have a donor in transit.
- 0 new listings unless the scale rule says the current SKU is allowed to have a sibling.

---

## Part H — Amazon procedure

Confirm every click-path in Seller Central the day you do it. Amazon renames buttons. The policy does not get more relaxed because a button moved.

### Open the account

1. sellercentral.amazon.com → sign up.
2. Choose Individual for the first test month if the category is allowed and you will not advertise. Professional is $39.99/month and is required for Sponsored Products (**FACT**, Amazon Ads).
3. Enter the LLC, EIN, address, phone, bank account, card, and a government ID.
4. Turn on two-step verification.
5. Finish identity verification before you buy inventory. A half-open account cannot receive a shipment later.

### Create the SKU

1. Catalog → Add products.
2. Search the part number and the generic name. If a listing already exists and it is the OEM's, do not add your offer to their listing unless you are selling that exact OEM part, which you are not.
3. Create a new listing.
4. Product ID: check "I don't have a product ID." If Amazon shows Apply now, that is the GTIN exemption.
5. Exemption photos: at least two real photographs, product in your hand or on a table, your brand name physically on the part or on the package, every side, no GS1 barcode in the frame. Renderings are not accepted for this application. Approval is often described as arriving by email within about two days. Wait until it is approved before you force the listing through.
6. SKU naming: `KNOB-DSHAFT-v03` — your code, version included, no OEM trademark as the SKU brand.
7. Brand field: your brand, spelled the way it is on the package. Not "Generic" once you have a brand on the bag. Not the appliance brand.

Variation families (D-shaft and spline are different children) are awkward under a GTIN exemption in the browser wizard. List the first child alone. Add a second child later with a flat file or the variation wizard once you have actually measured that second shaft. Do not create a child you have not held.

### FNSKU labels

You need these only when the SKU moves to FBA.

1. The FBA shipment workflow offers "print item labels."
2. Print the PDF on adhesive labels. A desktop laser and Avery labels are enough for the first shipment. A thermal printer waits until this is weekly.
3. One label per unit, flat, scannable, not across a curve, not covered by tape.
4. Cover any other barcode on the bag so the warehouse scans only the FNSKU.

### The listing

**Keyword research without a paid tool.**

1. Type your phrase into Amazon. Write down Amazon's autocomplete suggestions. Those are the words shoppers start.
2. Read the titles of the first 10 listings. The repeated nouns are your title words.
3. Read 20 reviews and the questions. The nouns buyers use ("D shaft", "timer knob", "not the gas knob") go in bullets.
4. After ads exist, the search-term report replaces autocomplete as the source of truth.

**Photos, in this order.**

1. Main: product on pure white, filling most of the frame, no text, no props, if the category style guide requires white. Check Seller Central Help, "Product image requirements," the day you upload.
2. The part installed on the donor, so the buyer sees the fit.
3. Caliper or a ruler in frame for scale.
4. The shaft or mating feature, straight on.
5. What is in the bag.
6. A simple image with the ban sentence and the material. Some categories restrict text on images. If the style guide forbids text, put the ban sentence in bullet 1 instead and keep the image clean.
7. An install photo with one arrow. Not a comic strip.

Phone, daylight from a window, white foam board. Tap to focus. That is the studio.

**Title, under 200 characters, front-load the words.**

`[Brand] Dryer Timer Knob, D-Shaft [measured mm], Compatible with [models you verified]`

Do not write: OEM, genuine, official, the best, number one, or a list of twenty brands you have not fitted.

**Five bullets.**

1. What it is, the measured mating feature, and what it is not.
2. The models you personally fitted, and "measure your shaft before you buy."
3. Material and the environment you have actually tested.
4. What is in the package.
5. Your brand and the version, plus the return reality: if the shaft does not match the photo, do not force it.

**Description.** Repeat the measurement and the install in plain sentences. No story about your grandfather's garage.

**Backend search terms.** Synonyms and part numbers you verified. Do not repeat the title. Do not put competitor brand names here to catch their traffic. Amazon has disciplined sellers for misuse of trademarks in keywords. Compatibility belongs in the visible compatibility fields, accurate, for models you fitted.

**Price.** The price that clears the calculator at your real postage, not the cheapest listing. Revisit it when fees change and when a competitor's price would push you under $15 per printer hour. In that case you exit or you change the offer. You do not follow them down.

### FBA shipment, when the trigger hits

1. Measure and weigh the packed unit. Re-run the fee model with that size tier.
2. Inventory → Send to Amazon (wording varies).
3. Enter the SKU and the quantity from the 30-day-cover rule.
4. Write down the placement fee on the screen. If it ruins the hour gate, cancel the shipment and stay FBM.
5. Label each unit. Box contents: either label every unit and follow the workflow Amazon currently allows for box content. Do not "skip" required prep.
6. Poly bag if the workflow says so. Suffocation warning if the bag opening is 5 inches or larger.
7. Ship the partnered carrier or your own label, whichever the screen shows as cheaper for that box. Small boxes of light parts are often cheaper on your own USPS label. Check both.
8. Set the ship-from address to your real address.

### Advertising

See Part B, step 15. Add these habits:

- Campaign naming: `SP-AUTO-KNOB-v03` and `SP-EXACT-KNOB-v03`.
- Placements: leave the bid adjustment at zero for two weeks. Do not buy "top of search" at a 50% boost on day one.
- Negative keywords: add as negative exact any term that is a different appliance, a gas valve, a full control panel, or a brand you do not fit.
- Once a week, move a search term that has at least two orders into the exact campaign and negative-exact it in the automatic campaign so you do not bid against yourself.
- TACOS = ad spend ÷ total revenue, from your sheet. If TACOS is above the max you calculated, cut the daily budget in half the same day.

### Inventory, returns, reviews

- Count finished goods every Friday. Days of cover = on hand ÷ average daily sales over 28 days. Under 14 days and the SKU is scaling: print. Over 60 days: stop printing.
- FBM returns: when the part comes back, QC it. If it is the current version and undamaged, it can be resold as used only if you say so. Do not put a stretched snap back into a "new" bin.
- FBA returns often come back unsellable. That is already why the return allowance exists. Read the reason codes anyway.
- The only review request you send is Amazon's "Request a review" button, once, after delivery. No inserts that offer a gift for a review. No messages that mention a positive star rating. No review clubs.

### What not to do

- Do not sell on the OEM's listing.
- Do not claim a certification you do not have (UL, food safe, OEM).
- Do not send a different revision than the photos.
- Do not message buyers off Amazon to complete a sale.
- Do not pay for reviews or for someone to up-vote a review.
- Do not open a second account because a listing was blocked.
- Do not list a restricted category (supplements, medical, children's products, many automotive safety parts) to "see if it goes through."
- Do not buy a UPC from a random barcode website.

---

## Part I — Thirty opportunities

Scored with the rubric in Part B. **Every row has volume not verified.** Prices and review counts are either from a page opened during this research or are left as "check this week" because they were not opened. A score is a research priority, not a promise of sales.

Evidence actually opened for this manual:

- Whirlpool 8268816 tine clip, ASIN B015T8TPEY, listed at $6.52, 4.5 stars, 23 reviews. Nearby aftermarket packs were around $6–$9. That is why dishwasher clips are not the company.

Ranks 1–3 are the only scores built from the rubric blocks below. Ranks 4–30 are priority judgments with the same rubric, and their economics are mostly in the kill zone. They are not separate calculator runs. Any rank falls to zero if the sold-listing pass or the patent pass fails.

| Rank | Product | Score | Blocks (demand / econ / IP / mfg / returns) | Verdict | Why it is here |
| --- | --- | --- | --- | --- | --- |
| 1 | Non-gas dryer or washer cycle knob, one measured shaft | 74 | 15 / 25 / 14 / 12 / 8 | TEST | Planning model is about $36 cash profit per printer hour. Demand points stay at 15 until your own sold sheet exists. |
| 2 | Euro-hinge drill jig, non-structural | 74 | 12 / 18 / 18 / 14 / 12 | TEST | Tie on total score. The knob wins the commercial slot because its economics block is 25, not 18. The jig is the practice slot you can print before a donor knob arrives. |
| 3 | Snowblower chute-aim knob, not a safety bail | 70 | 12 / 22 / 16 / 12 / 8 | TEST | Same manufacturing pattern as the cycle knob. September is the listing window for snow climates. |
| 4 | Mailbox plastic flag | 64 | judgment | DEEPER | Simple ASA part. Prove eBay sold prices are ≥ $18 before a prototype. |
| 5 | Closet-rod end support | 61 | judgment | DEEPER | Only with a written load test and a stated pound limit. Otherwise KILL. |
| 6 | Thermostat trim plate, old round to a rectangle you measured | 60 | judgment | DEEPER | Indoor PETG. Confirm you are not copying a patented plate. |
| 7 | Truck stake-pocket plug, one generation, ASA | 58 | judgment | DEEPER | Outdoor. One truck, one plug. "Fits all trucks" is a return machine. |
| 8 | Dehumidifier tank latch | 55 | judgment | DEEPER | Model-specific. Water exposure. PETG, donor required. |
| 9 | Shower-door bottom guide, not a bearing roller | 54 | judgment | DEEPER | Wet environment. Buyers already have metal rollers for sale. Only if the guide is the missing piece and the price holds. |
| 10 | Window crank handle | 50 | judgment | DEEPER | Splines fail at home. Prototype only after a donor and a designer if the spline is not a simple shape. |
| 11 | Dishwasher rack clip, single | 40 | calculator kill | KILL | Real demand language, fatal price. OEM example at $6.52. Printed unit fails the hour gate in the calculator (about $7/hour at $8.99 FBA). |
| 12 | Dishwasher clip multipack | 48 | judgment | HOLD | Revisit only if you can sell a tested ASA pack at ≥ $18 and beat the $9 molded packs on fit proof, not on price. Heat test required. Default is leave it. |
| 13 | Refrigerator rail clip | 50 | judgment | HOLD | Same pattern as the dishwasher clip. Open prices before any CAD. |
| 14 | Shop-vac hose adapter | 45 | judgment | KILL | Molded adapters already sell cheap. Printing a taper is how you spend an afternoon to save a buyer $4. |
| 15 | Blind wand connector multipack | 42 | judgment | KILL | Commodity, often a few dollars for a bag of 30. |
| 16 | Ceiling-fan pull coupler | 40 | judgment | KILL | Same price problem. |
| 17 | Under-desk headphone hook | 35 | judgment | KILL | Long enough to waste the hour, short enough that molded hooks are $8. |
| 18 | Gridfinity bins | 30 | judgment | KILL | Open designs, race to the bottom, print time. |
| 19 | Honeycomb wall panel | 28 | judgment | KILL | Print hours destroy the gate. |
| 20 | Holiday light clips | 25 | judgment | KILL | Molded bags of 100, plus FBA aged inventory after December. |
| 21 | Adhesive cable-clip pack | 25 | judgment | KILL | Injection molding already won. |
| 22 | Tracker-case clone | 20 | judgment | KILL | Trademark and a crowded $10 shelf. |
| 23 | Branded tool-box mounting plate clone | 10 | judgment | KILL | Design patents and trademarks around those systems are an actual risk. Do not design around them as a first company. |
| 24 | Action-camera mount clone | 15 | judgment | KILL | Crowded and IP-exposed. |
| 25 | Baby-gate hardware | 0 | hard ban | KILL | A falling gate is not a side project. |
| 26 | Fridge water-filter bypass | 0 | hard ban | KILL | Drinking water. |
| 27 | Mower deadman / bail | 0 | hard ban | KILL | That part is the safety system. |
| 28 | Garage-door sensor bracket | 0 | hard ban | KILL | A misaimed sensor is how a door hits a person or a car. |
| 29 | Food-container latch | 0 | hard ban | KILL | Food contact, layer lines, no certification. |
| 30 | Pool skimmer weir | 20 | judgment | KILL | Chlorine and a molded OEM part. FDM is the wrong process. |

### Top 10 for deeper research

Ranks 1–10. For each, this week's deeper pass is the same: 20 eBay sold rows, 10 Amazon listings, OEM list price, patent search, donor or a reason you cannot get one. Ranks 4–10 stay off the printer until that pass clears the hard gates.

### Top 5 for prototyping

1. Cycle knob, after the donor is in hand.
2. Euro-hinge drill jig, after you buy one 35 mm hinge and confirm the cup.
3. Snowblower chute knob, after the donor is in hand.
4. Mailbox flag, only if sold comps are at or above $18.
5. Closet-rod support, only if you will publish a load number you have tested with weight on a rod.

Do not prototype 4 and 5 in the same week as 1. The top 5 is a queue, not a batch.

### Top 3 for immediate testing

1. **Cycle knob.** The commercial bet. Economics in the walkthrough: about $36 cash profit per printer hour on the planning model at $27.99, FBM, no ads yet, 10% return allowance. Your postage quote can move that. Volume is not verified until your sold sheet says so.
2. **Euro-hinge drill jig.** The part you can design and destroy on scrap board without waiting for a donor knob. It teaches the printer. It is not allowed to be described as a structural repair plate.
3. **Snowblower chute knob.** Same manufacturing pattern as the cycle knob. Start the sold-listing pass the same week if you ship into a climate that snows. It is late September. Print it only after a donor arrives and the price gate holds. If you do not ship into snow, leave it on the sheet until next autumn.

### What each finalist must eventually contain

The walkthrough below fills this in for the knob. For the other two, use the same headings before they go live. Short form, so the gaps are visible:

**Snowblower chute knob.** Problem: the plastic knob that aims the chute is split, the machine still runs, the safety bail is a different part and is not for sale by you. Buyer: homeowner in a snow state, searching the machine model plus "knob." Competition: OEM parts sites and eBay; open the prices this week. Price target $24–$32 if the hour gate holds. Method: FDM, PETG for a fit check, ASA for a part that lives on the machine outdoors, 15–30 g, 20–40 minutes, planning cash COGS near $1.20. IP: search the OEM and "chute knob" on Google Patents; no logo. Variants: one shaft this month, a second shaft as another SKU only after 30 sales. Bundle: knob plus a one-page photo of which shaft you measured. Why it works: the machine is worth hundreds and the part is small. Why it fails: the shaft is different on the next model year, or a molded knob is already $9.

**Euro-hinge drill jig.** Problem: the screw holes beside a 35 mm cup are stripped and a flat mending plate does not show where the new screws should go. Buyer: someone repairing a cabinet, searching "euro hinge repair" or "stripped hinge holes." Competition: steel repair plates at hardware prices. You are selling the guide, not the structure. Price target $19–$23. Method: PETG, about 28 g, about 40 minutes. The planning FBM model for a similar part in the calculator (the "hinge plate" rows) is about $13.50 cash contribution and about $20 per printer hour before ads. That is a test, not a scale SKU, and it assumed a plate. A jig that prints faster improves the hour rate; a jig that prints slower gets killed. IP: original guide, no copied brand. Variants: 35 mm cup only, until you measure another. Bundle: jig plus a paper template. Why it works: you can test it on scrap this week. Why it fails: buyers are happy with a $6 steel plate, or they use the plastic jig as the hinge and it creeps. The listing has to forbid that use in the first bullet.

---

## Part J — First product walkthrough

**The product.** A dryer or washer cycle-selector knob for one model family you select from this week's eBay sold sheet. PETG. Target price $27.99. Amazon FBM and eBay. Print to order, then batches of 10.

**Not the product.** A gas-valve knob, an oven knob that controls a flame, a "universal" knob, or a dishwasher clip. The clip is the lesson, not the launch. It already has a genuine listing at $6.52 and aftermarket packs near $9. The calculator puts a single printed clip near $7 cash profit per printer hour. That is a kill.

The model number below is written as **MODEL YOU SELECT**. This manual does not crown a bestseller. You crown it with the sold sheet.

### Research, the afternoon you start

1. eBay, sold items, query `dryer knob`, then `washer knob`, then `timer knob dryer`. Record 20 rows: ended date, price, title, whether the shaft is visible. If fewer than 10 sales are visible, the evidence is thin. Pick a different noun or accept HOLD.
2. Sort your 20 by price. Delete rows under $18. Among the rest, pick the model text that appears most often and has a shaft photo.
3. Amazon search for that model plus `knob`. Record 10 listings. If a molded knob with hundreds of reviews is $12 and the questions say it fits your shaft, your printed version has to win on proof, not on being cheaper. If you cannot state why someone pays you more, KILL this model and take the next one on the sheet.
4. Open the OEM parts page. Record the list price and whether it can be ordered. A $40 OEM list price and a "no longer available" status is the situation you want. A $6 OEM part in stock is the dishwasher-clip situation. KILL.
5. Google Trends for `dryer knob`. You want to see that the term exists. You do not multiply the index by anything.
6. patents.google.com queries: `dryer knob`, and the OEM name plus `knob`. Write down what you opened. A plain round knob with a D-hole is a shape that has been made for decades; still write the search. If you find an active design patent that matches your specific geometry, change the external shape. The hole is functional. The outside can be plain.

### Validation spend, about $30, before the printer if you do not own one

Buy the used or OEM knob that matches the winning eBay title. When it arrives, measure the shaft three times. If the seller sent a different shaft, you just learned the return risk for free. Do not design the listing until the part in your hand matches the title you intend to use.

Paper gate, filled with the planning model (replace postage before you trust it):

| Input | Planning value |
| --- | --- |
| Grams | 22 |
| Minutes | 30 |
| Material | PETG at $18/kg |
| Price | $27.99 |
| Channel | Amazon FBM, postage placeholder $4.25 |
| Returns | 10% until you know |
| Ads | $0 until the ad trigger |
| Cash COGS | $1.14 |
| Referral | $4.20 |
| Postage | $4.25 |
| Return allowance | $0.54 |
| Cash contribution | $17.86 |
| After labor at 10 minutes | $14.53 |
| Cash profit per printer hour | $35.73 |

If your live postage to a far zone is $8, contribution falls by $3.75 and the hour rate falls with it. Re-run the script. If the hour rate drops under $15, raise the price or kill the model. Do not hope.

### Measurements

On the donor knob and, if you can, on the machine shaft it came from:

- Shaft type: D, double-D, round with set screw, or spline. Spline: stop and hire the designer.
- Flat-to-flat or diameter, three readings, millimeters.
- Hole depth.
- Knob diameter and height, so the listing photo matches the machine.
- A note of the model sticker on the machine, if you have the machine. If you only have the knob, the listing may only claim the shaft measurement plus the models shown in listings where this exact donor is pictured. Do not add models from memory.

### CAD brief, filled as far as a template can be

Use the Part F template. Working name: `KNOB-DSHAFT-v01`. Material: PETG. Ban sentence: "Not for gas valves or any control that operates a burner or a safety interlock." Orientation: shaft axis vertical only if the hole prints clean; if the D-flat is rough, print the knob with the hole vertical and plan to test, or print it on its side if the layers would otherwise split when the buyer twists. Twisting load should not peel layers. A knob printed with layers stacked so a twist splits the hub is the wrong orientation. Prefer the orientation where the hub's rings resist the twist, then test it. If you are unsure, that uncertainty is the designer hire.

Emboss your brand and `v01` on a face that is not the mating face.

### Prototype

1. Slice in Bambu Studio or OrcaSlicer. 0.20 mm, 4 walls, 20% gyroid, PETG starting range from Part G, brim on.
2. Dry the spool if the extruder pops.
3. Print one. Time it. Weigh it.
4. Fit it to the donor shaft. It should press on by hand and stay when you shake it. It should come off without tools or with the same method as the original.
5. Twist it as hard as a person turning a timer. If the hub cracks, add walls or change orientation and print v02. You get three tries.
6. Photograph each version on the shaft.

### Slicer notes that matter for this part

- A D-hole printed as a circle with a flat will come out tight. Start 0.2 mm tight on the flat-to-flat dimension and open it 0.1 mm per revision.
- Outer wall slow enough that the hole is round. If the hole is oval, slow the outer wall before you redraw the CAD.
- No support inside the hole. Supports in a shaft hole are how fit tests lie.
- 100% infill is unnecessary. Four walls are the knob.

### Inspection

Run the Part G checklist. Keep the donor shaft in the QC bin for every future batch. A part that does not go onto that shaft does not ship.

### Packaging

4 × 6 bag, slip inside, 6 × 9 mailer. Slip text:

```
[Brand] cycle knob, version v01
Shaft: D, [your mm] mm flat-to-flat
Fitted by us on: [models]
Material: PETG
Not an OEM part.
Not for gas valves or any control that operates a flame or a safety interlock.
Measure your shaft and compare it to the photo before you install this.
```

### Photography and listing

White-background hero of the knob. Second image: on the donor shaft, D-flat visible. Third: ruler. Title and bullets per Part H. Price $27.99 unless the calculator with real postage says to move it, in $1 steps, staying at or above $18 and off the $10 cliff.

Handling time: 2 business days while you print to order.

### First production quantity

Zero on the shelf the hour the listing goes up. After the second order inside any 7 days, print 10 of the current version only. Not a second shaft. Not a color choice.

### FBA

Not in the first month. Trigger remains 20 sales and returns at or under 8%. Then send 30 days of cover, labels on, placement fee written down.

### PPC

Not until 10 sales and the return gate, on the Professional plan. Automatic campaign $10/day and exact campaign $10/day with the part number and `dryer timer knob` plus the shaft phrase. Negatives on day 7 for gas, oven, and unrelated brands. Max CPC uses your real conversion rate once you have 30 clicks. Until then, bid half of 8% × pre-ad cash contribution and label the 8% as an assumption.

### Metrics for this SKU, every Friday

Units ordered, units shipped, refunds, reason tags, grams, minutes, postage paid, Amazon or eBay fees, cash contribution, cash profit per printer hour, clicks and spend if ads are on, TACOS.

### Reorder

At 0.5 units a day and a 2-day print lead time with safety stock of about 4 units, print 10 when on-hand finished goods hit 5. Adjust the arithmetic with your real average. The formula is in Part E.

### The decision at day 30 of the listing

- No sales and you have 200 listing views: the offer or the keyword is wrong. Change the main photo and the first bullet once. If the next 14 days are still zero, KILL this model and return to the sheet.
- Sales with a fit return: IMPROVE, new version, do not ship v01 again.
- 20 sales, returns at or under 8%, hour gate intact: SCALE using the FBA and ads triggers, still one shaft.

That is the whole company, once, on purpose.
