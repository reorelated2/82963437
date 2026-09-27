# Stage 1 — Audit and the strategy to build

Version 1 was not a separate plan. The assignment described a company that 3D-prints replacement parts, clips, brackets, mounts, and organizers and sells them through Amazon FBA, then asked for 30 products, a printer shopping list, and a path to injection molding.

That thesis has a real core and a fatal default path. The core stays. The default path is replaced below.

Labels used throughout:

- **FACT** — published by a primary source, or read off a public product page during this research (September 2026).
- **ESTIMATE** — a planning number from a secondary summary or a stated assumption in the calculator. Replace it before spending.
- **ASSUMPTION** — a choice this manual makes so the founder can act. It is not a measurement.
- **RECOMMENDATION** — what to do with your own money given the facts above.

No Amazon sales volume in this document was estimated with a keyword tool. Tools such as Jungle Scout and Helium 10 infer orders from rank. Those inferences are not used here. Where demand is real but uncounted, the manual says **volume not verified**.

---

## What the public record actually supports

**Amazon's fee floor is high relative to a small plastic part.**

- **FACT.** The Professional selling plan is $39.99 per month. The Individual plan is $0.99 per item sold. Source: [Amazon, Individual vs Professional](https://sell.amazon.com/blog/amazon-professional-vs-individual-selling-plan).
- **FACT.** Sponsored Products are available to Professional sellers. Source: [Amazon Ads](https://sell.amazon.com/advertising).
- **FACT (republished rate card, confirm in Seller Central).** For 2026, US FBA fulfillment fees for small standard-size items depend on shipping weight and on whether the price is under $10, from $10 to $50, or over $50. Secondary calculators reproducing Amazon's January 15, 2026 card show a 2 oz item at $2.43 under $10 and $3.32 from $10 to $50. A 3.5% fuel and logistics surcharge on fulfillment fees is described as effective April 17, 2026. Sources: [SellerGuards fulfillment table](https://sellerguards.com/amazon-fba-fulfillment-fees.html), [AMZ Seller Tools calculator](https://www.amzsellerstools.com/en/tool/fba-fee-calculator), [PrepVia 2026 fee notes](https://www.prepvia.com/blogs/amazon-fba-fee-changes-2026). **Use Amazon's Revenue Calculator on the live SKU before you trust any row.**
- **FACT (size tier).** Small standard-size is commonly described as at most 15 × 12 × 0.75 inches and 1 lb. A part that is thicker than 0.75 inches in the package, including the mailer, falls into large standard and the fee jumps. Design the package, not just the part.
- **ESTIMATE.** Aged-inventory surcharge, as summarized from Seller Central by several 2026 seller guides, starts at 181 days in the fulfillment network and steps up sharply after 270 days. Source example: [SellerEssentials](https://selleressentials.com/amazon-fba-long-term-storage-fees/). Confirm the live table. The operating consequence is solid either way: do not ship 6 months of a new SKU to FBA.

**A single cheap clip cannot carry FBA.**

- **FACT.** On a public Amazon page reviewed for this audit, the genuine Whirlpool 8268816 tine-row clip was listed at $6.52, rated 4.5 from 23 reviews (ASIN B015T8TPEY). An aftermarket pivot clip page showed prices around $6 to $9 for small packs, including an Ultra Durable 2-pack near $8.99. **Units sold per month were not on the page. Volume is not verified.**
- **ESTIMATE, from `playbook/tools/unit_economics.py`.** An 8 g ASA clip, 25 minutes, sold FBA at $8.99 with a 15% ad allowance and a 12% return allowance, produces about $7 per printer hour in cash and about $0.36 after owner labor at $20/hour. The manual's scale gate is $25 cash profit per printer hour. This SKU fails it. The same calculator shows a 90 g, 3.5 hour organizer at $12.99 losing money once owner time is counted ($0.25 cash profit per printer hour, negative after labor).

**Filament is cheap. Time and fees are not.**

- **FACT.** A filament price tracker that followed the same listings from April to September 2026 reported September averages of about $18.75/kg PLA, $15.97/kg PETG, $18.95/kg ABS, and $22.09/kg ASA. It is an Amazon-weighted sample of tracked brands, not the whole market. Source: [Filament Price Tracker](https://filamentpricetracker.com/news/filament-price-surge-fact-check-2026.html).
- **FACT.** EIA reported US residential average revenue of 18.34 cents per kWh for June 2026, as a proxy for retail price. Source: [EIA Electricity Monthly Update](https://www.eia.gov/electricity/monthly/update/end-use.php) and the June 2026 coverage of that release.
- **ESTIMATE.** At 120 watts and 18.34 ¢/kWh, a one-hour print costs about 2 cents of electricity. Electricity will not save or sink this business. A 3-hour print will.

**Printers capable of production materials are a few hundred dollars, not a factory.**

- **ESTIMATE, store snapshot.** A price tracker reading Bambu Lab's US store on September 22, 2026 showed the enclosed P1S at $399, the P2S at $549, and the open-frame A1 at $299. Source: [BambuHub](https://bambuhub.net/bambu-price-tracking). Confirm at checkout. Buy an enclosed machine if you intend to print ASA or ABS. An open-frame printer is the wrong tool for outdoor and dishwasher-heat parts.

**Demand for odd plastic parts is real. A catalog of organizers is a different business.**

- **FACT.** Public repair threads repeatedly ask for dishwasher rack clips, discontinued knobs, and parts the OEM no longer sells. Makers on r/3Dprinting report PLA softening in a dishwasher and ABS or ASA holding up better. That is evidence of the problem and of the material constraint. It is not evidence of how many people search Amazon per month.
- **FACT.** USPTO's base trademark application fee is $350 per class for Section 1 and 44 filings after the January 18, 2025 fee change. TEAS Plus at $250 no longer exists. Source: [USPTO fee summary](https://www.uspto.gov/trademarks/fees-payment-information/summary-2025-trademark-fee-changes).
- **ESTIMATE.** eBay's final value fee for most US categories is reported by 2026 fee calculators as 13.6% plus $0.40 on orders over $10, charged on the amount eBay includes in the total (item, shipping charged, and often tax). Confirm on eBay's own fee page the day you list. Source example: [seller fee summaries checked against eBay help](https://sellerfeecalc.com/ebay-fees/final-value-fee).
- **ESTIMATE.** Injection-mold tooling for a simple aluminum tool is often quoted from a few thousand dollars up. Published crossover ranges cluster between roughly 500 and 10,000 units. There is no universal breakeven. Use the formula in Part E with a real quote.

**Policy and liability sit on top of the margin.**

- **FACT.** Amazon's own GTIN instructions allow a listing without a product ID when you apply for an exemption, with photos of the product and packaging. Handmade goods are a stated exemption path in Seller Central discussions of that workflow. Reseller UPCs that you do not own through GS1 are a known way to lose the listing later.
- **RECOMMENDATION.** Do not sell children's products, food-contact parts, medical devices, or anything that affects brakes, steering, fuel, flame, a safety interlock, or a garage-door sensor. Hobby filament is a poor food-contact material because layer lines hold residue, and most spools are not certified for repeated food contact. A plastic plate that is the only thing holding a cabinet door is a falling-door risk. Sell a drill jig, or sell a part that has passed a written load test with a number you will print on the insert.

---

## The ten questions

### 1. What is fundamentally correct?

People will pay real money for a small plastic piece that puts a costly machine back into use, when the OEM part is gone, absurdly priced, or slow. Desktop printing is the right factory for that business at low volume: no mold, a design change the same day, and a few dollars of plastic. Complaint language ("can't find", "discontinued", "replacement", "fits") is the right raw material. Selling where the buyer already searches — Amazon and eBay — is the right demand test. Judging a SKU by contribution profit, then killing it, is the right management system.

### 2. What is wrong or incomplete?

Version 1 sends every idea to FBA, treats clips and organizers as one category, and starts spending on tools, trademarks, and UPCs before a single fit has been proven. It never faces the fee floor. A $7 part can be "in demand" and still be a bad product, because FBA fulfillment plus a 15% referral fee plus returns plus ads consume the price. It never faces print time. Margin percent on a 4-hour print can look fine and still pay less than a part-time hourly job. It never faces fitment returns, which are the normal outcome when a shaft, spline, or model year is wrong. It never separates safety-critical parts from inconvenience parts. It implies sales numbers the founder cannot see.

### 3. What should be removed?

- A printer farm, a photo studio, paid keyword software, a trademark filing, GS1 barcodes, and inventory software before one SKU has 20 clean sales.
- PLA as the default production material.
- The goal of launching 30 products. Thirty paper rows are useful. Thirty live SKUs are how this fails.
- FBA as the first fulfillment method.
- Organizers, headphone hooks, grid bins, honeycomb wall panels, holiday clips, and brand-clone mounts (tool-box systems, camera mounts, tracker cases) as the core catalog.
- Any part whose failure can injure someone or defeat a safety device.
- Injection molding as a Year-1 milestone. It is a formula you run later, not a plan you fund now.

### 4. What should be added?

- A written gate: price, grams, minutes, cash profit per printer hour, return risk, and IP risk. Fail one hard gate and the idea dies on paper.
- eBay sold listings and your own orders as the only demand counts you act on. Forum posts justify a closer look. They do not justify a purchase order.
- Merchant fulfillment first, in small batches you print after the order or in lots of 10 to 15.
- A donor part. You buy or borrow the broken original and measure it. You do not design a shaft from a photo.
- Material matched to the environment: PETG indoors, ASA outdoors or in a hot appliance, never PLA for heat, sun, or a dishwasher.
- An IP pass on Google Patents and a trademark search before the listing title uses a brand.
- A liability pass, an LLC, and an insurance quote before the first functional sale.
- Two profit lines on every SKU: cash, and cash after owner labor at $20/hour. Cash tells you whether the order funded the plastic. Labor tells you whether the company can hire.
- A kill rule you obey when returns, fit reviews, or printer-hour profit miss the line.

### 5. Where is the real economic opportunity?

The spread between the cost of replacing a machine and the cost of a 15-to-40-gram part the owner cannot buy, **when that part prints in under 45 minutes and the price clears about $25 cash profit per printer hour after fees.**

The calculator's "excellent" shape is an 18 g part, 22 minutes, $29.99, about $50 cash profit per printer hour on FBA after an 8% ad allowance. The "bad" shape is a 90 g, 3.5 hour organizer at $12.99, about $0.25 per printer hour. Both are planning models, not sales forecasts.

A second, smaller opportunity is a non-structural jig or template (for example a euro-hinge drill guide) where fit is forgiving and you are not competing with a $6 molded clip. It is a practice SKU and a possible small product. It is not the company.

The commodity-organizer market is owned by injection molding. Entering it on a desktop printer is how filament cost fools a founder.

### 6. What business would I build with my own money?

A one-printer, one-SKU shop that sells measured replacement knobs and similar small functional parts.

1. Spend a week filling the opportunity sheet from Amazon, eBay sold listings, and repair forums. Buy nothing but calipers.
2. Kill anything under $18, anything over 45 minutes, anything safety-critical, and anything that already has a molded equivalent within a few dollars of your price.
3. Buy one donor part for the winner. Measure it. Only then buy one enclosed printer and one spool.
4. Sell the first 15 to 30 units yourself on eBay and Amazon merchant fulfillment. Print to order.
5. Turn on a small Sponsored Products campaign only after 10 sales with a return rate under 8%, and only after upgrading to the Professional plan.
6. Move a SKU to FBA only after 20 sales, a return rate at or under 8%, and a package that stays in the small standard tier you modeled.
7. Buy printer two only when printer one has more sold work than it can print for two straight weeks, and the SKU still clears $25 cash profit per printer hour.
8. Ask for mold quotes only after one SKU has held at least 100 units a month for 60 days. Run the crossover formula. If the quote does not pay back inside the units you have already proven, keep printing.

I would not start with FBA, a brand registry, or 30 listings.

### 7. What would make this fail?

- Matching a $6 to $9 molded aftermarket clip and calling the loss "brand building."
- Shipping several model variants into FBA before anyone has confirmed fit.
- PLA inside a dishwasher, a car cabin, or direct sun.
- A title that looks like you are Whirlpool, Dyson, Milwaukee, or Apple.
- Ads on a listing that converts under 5% after a couple hundred clicks.
- Treating a 4-hour print with a 60% "margin" as a win.
- A part that holds a door, a child gate, or a safety sensor.
- No ventilation while printing ABS or ASA in a living space.
- Quitting the kill rule because the printer is paid for and "should stay busy." A busy printer on a bad SKU loses money faster.

### 8. What would create a defensible advantage?

Not the shape of a clip. Someone can scan it.

The advantage worth having is a private book of measurements: shaft type, diameters, model numbers you have physically checked, photos of the fit, and the wording that keeps returns down. Each confirmed model makes the next listing faster. Rank and reviews on the exact part-number search are the marketplace version of that book. Brand Registry, after a real USPTO filing, is how you keep a sloppy copycat off your listing. It does not stop them listing a compatible part of their own.

A patent on a simple knob is usually a slow, expensive way to protect something that is easy to design around. Spend that attention on fit data and on speed.

### 9. What should be tested before any serious equipment purchase?

Before the printer:

1. Twenty eBay sold rows and ten Amazon listings for the exact phrase, with price, review count, and whether a molded alternative exists. Volume still unknown unless the page shows it.
2. The fee model in `tools/unit_economics.py`, with your live postage quote pasted over the $4.25 placeholder.
3. A donor part in hand, or a published dimensional standard you can test on scrap (the 35 mm euro-hinge cup is a standard you can check with calipers on a real hinge).
4. A patent search and a one-page note that says "no live design or utility patent found that reads on this shape" or "killed."
5. A scrap fit or a shaft measurement. If you cannot measure it, you cannot sell it.

Calipers are bought before the printer. The printer is bought after one idea passes the paper gate and you have something to measure. A second printer is a scale purchase, not a setup purchase.

### 10. What changes raise the odds?

- Sell the pack or the model-specific knob, not the single commodity clip.
- Use eBay sold comps as the demand source Amazon hides.
- Print to order until returns are measured.
- Orient and material-match the part so the first ten buyers do not become the test lab.
- Keep a kill column and use it every Friday.
- Let one SKU reach 30 sales before a second SKU goes live. The research sheet can keep growing. The factory cannot.

---

## The redesigned strategy

**Company.** A home shop that sells a few measured, non-safety plastic parts to people who are stuck. Amazon and eBay are the stores. The printer is the low-volume factory. FBA is a later shipping desk for a SKU that has already proven fit and velocity.

**Customer.** A household or a small repair job. The machine still works except for one plastic piece. They will pay $22 to $40 today. They will not pay $22 for a hook they can get, molded, for $8.

**Offer.** Your brand name, the generic part name, the measured shaft or hole, the models you have confirmed, a photo of the fit, and a sentence that states what the part is not (not OEM, not a gas valve, not a child gate, not food contact).

**Economics to accept a SKU.** All of these, on paper, using the calculator and a live postage quote:

| Gate | Pass | Kill |
| --- | --- | --- |
| Price | $18 or more, and not sitting on the $9.99 / $10.00 fee cliff by accident | Under $18, or a price that only "works" if ads are zero and returns are zero |
| Print time | 45 minutes or less for the unit you actually sell (the plate, if you sell a plate) | Over 45 minutes unless cash profit per printer hour still clears $25 |
| Mass | 40 g or less of production material | Over 40 g unless the price rises with it and the hour gate still passes |
| Cash profit per printer hour | $25 or more after fees, postage, an ad allowance, and a return allowance | Under $15, kill. Between $15 and $25, test only, do not buy printer two |
| After owner labor at $20/hour | Positive | Negative |
| Returns you are willing to discover | You can get a donor and measure it | Fit depends on a model year you have not held |
| IP | Patent search written down; your brand is not their brand | Live patent, logo, or a cloned branded system |
| Safety | Failure is inconvenience | Failure can injure, leak fuel, mis-aim a sensor, or go in a mouth or a child's product |

**Channel order.** eBay and Amazon FBM, print to order, lots of 10 once two orders land in a week. Professional plan and Sponsored Products after the fit is proven. FBA after 20 sales and a return rate at or under 8%. A second printer after utilization, not before. A mold quote after 100 units a month for 60 days.

**Catalog order.** First commercial bet: a non-gas appliance cycle knob for one model you select from that week's eBay sold sheet, priced around $28, PETG, under 30 minutes. In parallel, as print practice and a possible small SKU: a non-structural euro-hinge drill jig, tested on scrap board, never described as the thing that holds the door. Next commercial sibling: a snowblower chute-aim knob, same rules as the cycle knob, timed before winter if you sell into a snow climate.

The other 27 ideas in Part I are a ranked research list. Most are there to be declined on purpose.
