# Desktop parts company — operator's manual

This folder is a standalone operating manual. It is not part of the Buyer Command Center app in the rest of this repository.

The original assignment ended with the placeholder "PASTE THE ENTIRE PREVIOUS MASTER PROMPT HERE." There was no separate Version 1 business plan attached. This manual treats the business described in that assignment as Version 1:

> Use a desktop 3D printer to make replacement parts, adapters, holders, mounts, clips, brackets, and organizers, and sell them on Amazon FBA.

Read in this order:

| File | What it is |
| --- | --- |
| [00-audit-and-strategy.md](00-audit-and-strategy.md) | Stage 1. What is true, what fails, and the model to build. |
| [01-master-prompt-v2.md](01-master-prompt-v2.md) | Stage 2. The prompt to hand to another research system. |
| [02-ingredients-and-first-recipe.md](02-ingredients-and-first-recipe.md) | Parts A and B. What to buy, and Day 1 through scale. |
| [03-numbers-cad-print.md](03-numbers-cad-print.md) | Parts C, E, F, and G. SOP, formulas, CAD, printing. |
| [04-research-amazon-products.md](04-research-amazon-products.md) | Parts D, H, I, and J. Weekly research, Amazon, 30 ideas, one full walkthrough. |
| [05-decisions-roadmap-automation.md](05-decisions-roadmap-automation.md) | Parts K, L, M, N, and O. Rules, calendar, 90 days, year one, automation. |
| [06-founders-playbook.md](06-founders-playbook.md) | The one-page checklist from today through $25,000 a month. |
| [templates/opportunity-sheet.csv](templates/opportunity-sheet.csv) | The sheet you fill every week. |
| [tools/unit_economics.py](tools/unit_economics.py) | The formulas behind the worked examples. |
| [agent/](agent/) | The operator that runs those workflows. |

Run the agent:

```bash
cd playbook/agent && npm test && npm start
```

Open `http://127.0.0.1:8091`. It scores, prices, blocks banned parts, writes the CAD brief and the listing, and stops when a human has to measure a donor or read a patent. It does not invent sales volume.

Fees, filament prices, and postage change. Every dollar figure in here is labeled **FACT**, **ESTIMATE**, **ASSUMPTION**, or **RECOMMENDATION**. Before you buy inventory or turn on ads, replace the estimates with the number Amazon, eBay, your utility, and your postage account show you that day.

Sales volume is never invented. If a monthly unit count is not on a public page or in your own orders, it is not in this manual.

This is an operating guide, not a law firm, a tax preparer, an insurer, or a safety certification. Confirm category rules in Seller Central. Get an insurance quote before you sell a part that holds weight, sits in heat, or goes on a vehicle.
