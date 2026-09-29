# Parts C, E, F, and G — From a complaint to a printed part

## Part C — Product development SOP

One page, one direction. Do not skip a box. The person doing the step writes their initials and the date in the sheet.

```
Customer problem discovered
  A sentence in the buyer's words, plus the link.
        |
        v
Demand verified
  eBay sold rows recorded, Amazon prices recorded, volume left blank if unseen.
  KILL if you cannot show listings or sold items and the price gate fails.
        |
        v
Competition analyzed
  Ten Amazon listings and the molded alternative's price.
  KILL if a molded equivalent is already under $12 and you are printing the same thing.
        |
        v
IP checked
  Patent numbers written down, or "none found in this search" with the queries you used.
  Brand name searched. KILL if a live patent reads on the shape.
        |
        v
Safety checked
  Write how the part fails. KILL if failure injures, feeds a mouth, aims a sensor,
  controls a flame, or holds a door and you have no load test.
        |
        v
Product specification written
  The CAD brief. Every mating dimension has a caliper number and a unit.
        |
        v
CAD created
  Version number in the file name: BRAND-KNOB-DSHAFT-v03.FCStd
        |
        v
Prototype printed
  Fit-check only. Marker on the part: NOT FOR SALE.
        |
        v
Fit tested
  On the donor, three install/remove cycles, photo, dimension delta written down.
  Three failures: hire a designer. Do not freehand a fourth.
        |
        v
Stress tested
  Install, twist with the force a buyer will use, heat-test if the part sees heat
  (a cup of 60°C water is not a dishwasher; for a hot appliance, run the real cycle
  in a machine you own or do not claim dishwasher survival).
        |
        v
Unit economics confirmed
  Actual grams, actual minutes, actual postage. Calculator. Gate.
        |
        v
Photography
  White background hero, fit photo, scale photo, "what's in the bag," ban sentence.
        |
        v
Listing
  eBay and, when the account exists, Amazon FBM. Print to order.
        |
        v
Production
  Batch of 10 only after the second order inside seven days. QC each part.
        |
        v
FBA
  Only after 20 sales and returns at or under 8%. Thirty days of cover.
        |
        v
Advertising
  Only after 10 sales, returns at or under 8%, Professional plan.
        |
        v
Customer feedback
  Every return and every message, tagged: fit, strength, wrong model, shipping, other.
        |
        v
Design revision
  A new version number. Old stock is not mixed in. Listing photos updated the same day.
        |
        v
Scale
  Second printer, FBA, or a mold quote, only on the triggers in Part K.
```

---

## Part E — The numbers

All of the worked results below come from `playbook/tools/unit_economics.py`. Re-run it if you change a rate. Planning rates inside the script:

| Input | Value used | Label |
| --- | --- | --- |
| Referral fee | 15%, minimum $0.30 | FACT for most categories; confirm the category |
| Small-standard FBA base, $10–$50, then × 1.035 fuel | 2 oz $3.32, 4 oz $3.42, 6 oz $3.45, 8 oz $3.54 | ESTIMATE of the republished 2026 card. Confirm in Revenue Calculator |
| Under $10, 2 oz base | $2.43 before fuel | Same |
| eBay most categories | 13.6% + $0.40 | ESTIMATE. Confirm on eBay |
| Postage placeholder | $4.25 | ESTIMATE. Replace with a live quote |
| Electricity | 0.12 kW × $0.1834/kWh | kWh is the June 2026 EIA residential proxy. Watts are an estimate |
| Printer | $399 / 4,000 hours | Price is a store snapshot. Life is an assumption |
| Owner labor | $20/hour | ASSUMPTION, shown separately from cash |
| Filament planning prices | PLA $20, PETG $18, ASA $24 per kg | ESTIMATE, slightly above the September 2026 tracker averages |

### Formulas

```
filament cost        = grams × (filament $/kg ÷ 1000)
electricity          = (minutes ÷ 60) × (watts ÷ 1000) × $/kWh
depreciation         = (minutes ÷ 60) × (printer $ ÷ life hours)
failure allowance    = fail rate × (filament cost + electricity)
labor                = (labor minutes ÷ 60) × labor $/hour
cash COGS            = filament + electricity + depreciation + failure + packaging
full COGS            = cash COGS + labor

FBA fees             = max($0.30, price × referral) + (fulfillment base × 1.035)
FBM fees             = max($0.30, price × referral) + postage
eBay fees            = price × 0.136 + per-order fee + postage

return allowance     = return rate × (cash COGS + postage)
                       Planning cushion. Amazon's actual return fee comes from your report.
ad spend             = price × TACOS

cash contribution    = price − marketplace fees − postage − cash COGS − ad spend − return allowance
after owner labor    = cash contribution − labor
cash margin          = cash contribution ÷ price
pre-ad cash          = price − marketplace fees − postage − cash COGS − return allowance
max TACOS            = pre-ad cash ÷ price
break-even ROAS      = price ÷ pre-ad cash
max CPC              = conversion rate × pre-ad cash
cash profit / hour   = cash contribution ÷ print hours
cash profit / gram   = cash contribution ÷ grams

break-even units     = monthly fixed costs ÷ cash contribution per unit
                       Fixed at the start is $0 if you are on the Individual plan and own the printer.
                       After you upgrade, include $39.99.

reorder point, units = (average daily sales × lead time days) + safety stock
days of cover        = units on hand ÷ average daily sales
mold crossover units = mold quote ÷ (your cash COGS − their part price)
                       Switch only if crossover is below the units you have already sold
                       across a 60-day run rate you trust.
```

Storage, inbound placement, and low-inventory fees are not in the default script because Amazon shows them inside the shipment workflow and they are $0 while you are merchant fulfilled. The week you create an FBA shipment, write down the placement fee per unit Amazon displays and subtract it. If it is over $0.50 on a sub-$30 part, prefer the shipment option Amazon prices lower, or stay FBM.

Aged inventory: do not send more than 30 days of cover on a SKU until it has 90 days of stable sales. The surcharge summaries start at day 181. Your own rule is stricter on purpose.

### BAD PRODUCT — commodity organizer

90 g, 210 minutes, PLA at $20/kg, 15% fail allowance, 12 minutes of labor, FBA, price $12.99, ship weight 6 oz, TACOS 25%, returns 10%.

| Line | Amount |
| --- | --- |
| Cash COGS | $3.06 |
| Full COGS with labor | $7.06 |
| Amazon fees | $5.52 |
| Ad spend | $3.25 |
| Cash contribution | $0.86 |
| After owner labor | **−$3.14** |
| Cash profit per printer hour | **$0.25** |

This is what "filament only costs $1.80" hides. Kill this shape even if the listing has reviews. Those reviews belong to a molded seller.

### AVERAGE PRODUCT — functional part around $25

35 g, 50 minutes, PETG at $18/kg, FBA, $24.99, 4 oz, TACOS 12%, returns 8%, 8 minutes of labor.

| Line | Amount |
| --- | --- |
| Cash COGS | $1.38 |
| Amazon fees | $7.29 |
| Ad spend | $3.00 |
| Cash contribution | $13.21 |
| After owner labor | $10.54 |
| Cash profit per printer hour | **$15.85** |

This may be sold as a test. It does not earn a second printer. The hour gate for scale is $25.

### EXCELLENT PRODUCT — small, fast, higher price

18 g, 22 minutes, ASA at $24/kg, FBA, $29.99, 3 oz, TACOS 8%, returns 8%, 7 minutes of labor.

| Line | Amount |
| --- | --- |
| Cash COGS | $1.18 |
| Amazon fees | $8.04 |
| Ad spend | $2.40 |
| Cash contribution | $18.28 |
| After owner labor | $15.95 |
| Cash profit per printer hour | **$49.85** |
| Break-even ROAS | 1.45 |
| Max TACOS before the cash contribution is zero | 68.9% |

You will not get a 69% TACOS budget. The max TACOS is the point where you make no cash profit. Operate at a fraction of it. This shape is what the research recipe is hunting: short time, small mass, a buyer who is stuck.

### The $10 cliff, so you do not price yourself into it

On the republished card, a 2 oz small-standard unit goes from a $2.43 base under $10 to a $3.32 base at $10–$50, before the 3.5% fuel surcharge. Crossing $10 also changes the referral dollars. Run both prices in the calculator. A jump from $9.99 to $10.49 can raise fees by more than the extra revenue. If you need to be above the cliff, go to a real price ($22 and up), not to $10.49.

### Worked reorder example

You sold 20 units in 40 days. Average daily sales = 0.5. You print to order, so lead time is 2 days. Safety stock = 7 × 0.5 = 3.5, round up to 4. Reorder point = 0.5 × 2 + 4 = 5. When finished goods hit 5, print a batch of 10. Do not print 100 because the printer is idle.

### Worked mold example

Your cash COGS is $1.14. A molder quotes $4,000 for the tool and $0.40 per part. Crossover = 4000 / (1.14 − 0.40) = about 5,400 units. You sell 100 a month. Payback is about 54 months of today's demand, and that ignores the risk that the SKU dies. Do not cut the tool. At 500 a month the same quote is about 11 months. Then ask whether those 500 lasted 60 days or were a spike, and get two more quotes before you send a deposit.

---

## Part F — CAD for someone who is not a CAD expert

### The measurement ritual

1. Calipers on. Close the jaws. Zero them.
2. Measure the mating feature three times. Write all three. If they disagree by more than 0.1 mm, clean the part and measure again.
3. Photograph the caliper on the part so the number is in the photo.
4. Sketch the part on paper. Dimension the sketch. The sketch is the spec. The CAD file is a copy of the sketch.

What to measure on a knob: overall diameter, height, shaft hole shape (D, round, splined), the flat-to-flat or diameter of the shaft, hole depth, and any keyway width. On a clip: wire diameter, opening, thickness, and the distance between hooks. On a jig: the published standard plus the donor hinge in your hand. Euro-style concealed hinges commonly use a 35 mm cup. Confirm that on your hinge with the calipers. Do not assume every hinge is that cup.

### Tolerance, fit, and strength

FDM is routinely off by a few tenths of a millimeter. Design the first hole 0.2 mm tight and the second revision from the fit test, in 0.1 mm steps. A sliding fit wants about 0.3 to 0.5 mm of total clearance. A snap that must flex wants the flex in the plane of the layers, not as a pull that splits layers apart.

Walls: at least 1.2 mm (three lines from a 0.4 mm nozzle). Clips and knobs: 2.0 mm or more. Screw holes: look up the heat-set insert's datasheet and use its hole diameter. A common M3 brass insert wants a hole near 4.0 mm, and "near" is how people scrap parts. Use the datasheet for the insert you bought.

Infill does less for strength than walls do. Four walls and 20% infill beats two walls and 80% infill on most of these parts, and it finishes sooner.

Orientation: the layer lines are the grain of the wood. A clip printed so the hook is built up in Z will snap along a layer. Turn it so the hook's curve is drawn flat on the bed. Supports: if you can flip the part and avoid them, do that. Supports on a mating surface ruin the fit.

### When AI CAD helps, and when a person should

AI CAD (a text-to-solid or image-to-solid tool inside your CAD package, or a separate generator) is useful for a starting block: a disc, a rectangular jig, a simple hook. It is not useful as the final word on a spline, a snap, or a hole that must match a shaft.

Hire a human designer when any of these is true:

- Three fit prints have failed.
- You have spent more than 6 hours in CAD on one part.
- The mating feature is a spline, a living hinge, or a thread.
- You cannot get the sketch fully dimensioned. The designer cannot read your mind either. Stop and measure.

Where to hire: a freelance CAD designer on a job board, paid per revision, with a cap. A fair first job is a fixed price for one solid and two fit revisions. Do not buy an open-ended hourly engagement.

### What you send the designer

Send the brief below, the photos with calipers in frame, the donor if they are local or a second set of photos of every face, and the sentence "dimensions on the sketch override the photos."

### CAD design brief template

```
BRAND / WORKING NAME:
PART NAME:
VERSION:
DATE:
DESIGNER:

WHAT THE BUYER IS TRYING TO DO
(one sentence)

WHAT THIS PART MUST NOT BE
(gas valve, food contact, child product, structural hinge, etc.)

DONOR PART
Where it came from:
Model numbers verified in hand:
Photo folder link:

MATERIAL
Production material:
Fit-check material (PLA allowed only for geometry):
Environment (indoor, sun, dishwasher, car):

FUNCTION
How it mounts:
How it is removed:
Load, if any, in pounds, and how you will test it:

DIMENSIONS (millimeters, three readings each)
1.
2.
3.
Critical mating dimension and the tolerance you will accept:

CAD REQUIREMENTS
Hole or shaft revision plan (start tight by 0.2 mm, step 0.1 mm):
Minimum wall:
Orientation you believe is correct, and why:
Supports allowed on which faces:
Insert datasheet link, if any:
Text to emboss (your brand, version). No OEM logo.

FILES REQUESTED
Native file, STEP, and 3MF or STL
File name: BRAND-PART-FEATURE-v01

ACCEPTANCE
Fits the donor with three install/remove cycles
Dimension delta on the mating feature ≤ 0.3 mm versus the target you set after the fit test
No crack
Grams and minutes from the slicer written on this brief

PRICE AND KILL
Target sell price:
Quote from unit_economics.py at those grams and minutes:
If cash profit per printer hour < $15, stop. Do not pretty the model.
```

---

## Part G — Printing recipe

These are starting ranges for a 0.4 mm nozzle on an enclosed Bambu-class machine. They are not a profile you paste onto every file. Change one thing at a time and write it in the print log.

| | PLA (fit check only) | PETG (default production) | ASA (sun, heat, dishwasher trials) | ABS (use ASA instead unless you already know ABS) |
| --- | --- | --- | --- | --- |
| Use it for | Geometry practice indoors | Knobs, jigs, indoor clips | Outdoor caps, hot-appliance trials you have actually heat-tested | Same jobs as ASA, with more warp and more fumes |
| Do not use it for | Sun, car, dishwasher, anything you will ship as functional if PETG prints it | Long sun exposure, a claim of dishwasher life you have not tested | A room with no ventilation | A room with no ventilation |
| Nozzle | 200–215°C | 230–250°C | 240–260°C | 240–260°C |
| Bed | 55–60°C | 70–80°C | 90–100°C | 90–100°C |
| Chamber | Open is fine | Enclosed preferred | Enclosed, let the chamber warm | Enclosed |
| Part fan | 100% after layer 3 | 20–50% | 0–20% | 0–20% |
| Layer height | 0.20 mm | 0.20 mm; 0.16 mm if a shaft must be rounder | 0.20 mm | 0.20 mm |
| Walls | 3 | 4 | 4–6 on a snap | 4–6 |
| Infill | 15% gyroid | 20% gyroid | 25% gyroid | 25% gyroid |
| Speed | The printer's default standard profile | 10–20% slower than PLA if corners lift | Slow the outer wall | Slow the outer wall |
| First layer | Paper-thickness squish, brim if the footprint is small | Brim on small parts | Brim almost always | Brim almost always |
| Dry the spool | Optional if new | Yes if you hear pops | Yes | Yes |

Which product gets which material:

- Cycle knobs and indoor jigs: PETG.
- Anything that lives outdoors or in a sunny cab: ASA, after a PETG fit check.
- Dishwasher interior: do not sell it until an ASA or ABS part has survived real cycles in a machine you control. PLA is a known failure there. PETG is a maybe that has disappointed people in public repair threads. **RECOMMENDATION:** leave dishwasher clips on the kill list until that test exists, because the molded aftermarket is already cheap.
- TPU is for a grip sleeve, not for the first 90 days. It is slow and the slicing is fussier.

Strength comes from walls and orientation. Surface quality comes from a slower outer wall, a dry spool, and a clean plate. If the part must look smooth on a mating face, that face should not be the one sitting on supports.

### Production QC checklist (sign each part or each plate)

```
Date / printer / spool lot / profile name / version of the file
[ ] Correct file version is the one sliced
[ ] Spool matches the material on the work order
[ ] First layer stuck, no lifted corner
[ ] No stringing across a mating hole
[ ] Mating dimension checked with calipers on 1 part per plate of 8, or on every part if the plate is 1
[ ] Installs on the donor sample you keep in the bin
[ ] No crack, no missing wall
[ ] Brand and version emboss readable
[ ] Weighed within 10% of the slicer grams
[ ] Bagged with the slip that states models and the ban sentence
[ ] Failed parts in the fail bin, counted, not shipped
```

Fail rate this week = failed parts ÷ parts started. When PETG is above 8% or ASA above 12% for a week, stop production and fix the profile or the dryer before you print more saleable parts.
