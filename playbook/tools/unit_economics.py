#!/usr/bin/env python3
"""Unit economics for a desktop-printed part sold on Amazon or eBay.

Planning rates are documented in playbook/03-numbers-cad-print.md.
Replace every rate with the live Seller Central, eBay, postage, and
utility figure before spending money. This script does not know your
account.
"""

from __future__ import annotations

import argparse
import json

# Small-standard fulfillment base fees, US, non-apparel, price $10-$50.
# Republished 2026 rate card. Confirm in Amazon Revenue Calculator.
SMALL_STANDARD_10_TO_50 = [
    (2, 3.32),
    (4, 3.42),
    (6, 3.45),
    (8, 3.54),
    (10, 3.68),
    (12, 3.78),
    (14, 3.91),
    (16, 3.96),
]

SMALL_STANDARD_UNDER_10 = [
    (2, 2.43),
    (4, 2.49),
    (6, 2.56),
    (8, 2.66),
    (10, 2.77),
    (12, 2.82),
    (14, 2.92),
    (16, 2.95),
]


def fulfillment_base(weight_oz: float, price: float) -> float:
    table = SMALL_STANDARD_UNDER_10 if price < 10 else SMALL_STANDARD_10_TO_50
    if weight_oz <= 0 or weight_oz > 16:
        raise ValueError("This helper only covers small standard up to 16 oz")
    for limit, fee in table:
        if weight_oz <= limit:
            return fee
    return table[-1][1]


def evaluate(
    name: str,
    price: float,
    grams: float,
    print_minutes: float,
    filament_per_kg: float,
    fail_rate: float,
    ship_weight_oz: float,
    channel: str,
    tacoss: float,
    return_rate: float,
    labor_minutes: float = 8,
    labor_rate: float = 20,
    packaging: float = 0.60,
    postage: float = 4.25,
    watts: float = 120,
    kwh_price: float = 0.1834,
    printer_cost: float = 399,
    printer_hours: float = 4000,
    referral_rate: float = 0.15,
    fuel_surcharge: float = 0.035,
    ebay_rate: float = 0.136,
    ebay_order_fee: float = 0.40,
) -> dict:
    material = grams * (filament_per_kg / 1000)
    hours = print_minutes / 60
    electricity = hours * (watts / 1000) * kwh_price
    depreciation = hours * (printer_cost / printer_hours)
    failure = fail_rate * (material + electricity)
    labor = (labor_minutes / 60) * labor_rate
    cash_cogs = material + electricity + depreciation + failure + packaging
    full_cogs = cash_cogs + labor

    if channel == "fba":
        referral = max(0.30, price * referral_rate)
        fulfill = fulfillment_base(ship_weight_oz, price) * (1 + fuel_surcharge)
        marketplace_fees = referral + fulfill
        outbound = 0.0
    elif channel == "fbm":
        referral = max(0.30, price * referral_rate)
        marketplace_fees = referral
        outbound = postage
    elif channel == "ebay":
        marketplace_fees = price * ebay_rate + ebay_order_fee
        outbound = postage
    else:
        raise ValueError("channel must be fba, fbm, or ebay")

    ad_spend = price * tacoss
    # A returned unit is modeled as losing the cash COGS and the outbound
    # cost, and refunding the buyer. Recovered value is assumed to be zero
    # until the founder proves otherwise. Marketplace fees on returns vary;
    # this allowance is a planning cushion, not Amazon's return-processing fee.
    return_allowance = return_rate * (cash_cogs + outbound)

    cash_contribution = price - marketplace_fees - outbound - cash_cogs - ad_spend - return_allowance
    full_contribution = cash_contribution - labor
    cash_margin = cash_contribution / price
    max_tacos = (price - marketplace_fees - outbound - cash_cogs - return_allowance) / price
    # Break-even ROAS on ad spend: revenue / ad spend, when ad spend consumes
    # the entire pre-ad cash contribution.
    pre_ad_cash = price - marketplace_fees - outbound - cash_cogs - return_allowance
    break_even_roas = (price / pre_ad_cash) if pre_ad_cash > 0 else None
    profit_per_hour_cash = cash_contribution / hours if hours else None
    profit_per_gram_cash = cash_contribution / grams if grams else None

    return {
        "name": name,
        "channel": channel,
        "price": round(price, 2),
        "material": round(material, 2),
        "electricity": round(electricity, 3),
        "depreciation": round(depreciation, 3),
        "failure_allowance": round(failure, 3),
        "packaging": round(packaging, 2),
        "labor": round(labor, 2),
        "cash_cogs": round(cash_cogs, 2),
        "full_cogs": round(full_cogs, 2),
        "marketplace_fees": round(marketplace_fees, 2),
        "outbound_postage": round(outbound, 2),
        "ad_spend": round(ad_spend, 2),
        "return_allowance": round(return_allowance, 2),
        "cash_contribution": round(cash_contribution, 2),
        "contribution_after_owner_labor": round(full_contribution, 2),
        "cash_contribution_margin": round(cash_margin, 3),
        "max_tacos_before_loss": round(max_tacos, 3),
        "break_even_roas": None if break_even_roas is None else round(break_even_roas, 2),
        "cash_profit_per_printer_hour": None
        if profit_per_hour_cash is None
        else round(profit_per_hour_cash, 2),
        "cash_profit_per_gram": None if profit_per_gram_cash is None else round(profit_per_gram_cash, 2),
        "print_hours": round(hours, 3),
    }


EXAMPLES = [
    dict(
        name="BAD commodity organizer",
        price=12.99,
        grams=90,
        print_minutes=210,
        filament_per_kg=20,
        fail_rate=0.15,
        ship_weight_oz=6,
        channel="fba",
        tacoss=0.25,
        return_rate=0.10,
        labor_minutes=12,
        packaging=0.55,
    ),
    dict(
        name="AVERAGE functional kit",
        price=24.99,
        grams=35,
        print_minutes=50,
        filament_per_kg=18,
        fail_rate=0.08,
        ship_weight_oz=4,
        channel="fba",
        tacoss=0.12,
        return_rate=0.08,
        labor_minutes=8,
        packaging=0.60,
    ),
    dict(
        name="EXCELLENT small high-price part",
        price=29.99,
        grams=18,
        print_minutes=22,
        filament_per_kg=24,
        fail_rate=0.12,
        ship_weight_oz=3,
        channel="fba",
        tacoss=0.08,
        return_rate=0.08,
        labor_minutes=7,
        packaging=0.65,
    ),
    dict(
        name="FIRST PRODUCT hinge plate FBM test",
        price=22.99,
        grams=28,
        print_minutes=40,
        filament_per_kg=18,
        fail_rate=0.08,
        ship_weight_oz=4,
        channel="fbm",
        tacoss=0.0,
        return_rate=0.08,
        labor_minutes=10,
        packaging=0.70,
        postage=4.25,
    ),
    dict(
        name="FIRST PRODUCT hinge plate eBay test",
        price=22.99,
        grams=28,
        print_minutes=40,
        filament_per_kg=18,
        fail_rate=0.08,
        ship_weight_oz=4,
        channel="ebay",
        tacoss=0.0,
        return_rate=0.08,
        labor_minutes=10,
        packaging=0.70,
        postage=4.25,
    ),
    dict(
        name="CASE STUDY cycle knob Amazon FBM",
        price=27.99,
        grams=22,
        print_minutes=30,
        filament_per_kg=18,
        fail_rate=0.08,
        ship_weight_oz=3,
        channel="fbm",
        tacoss=0.0,
        return_rate=0.10,
        labor_minutes=10,
        packaging=0.65,
        postage=4.25,
    ),
    dict(
        name="KILLED dishwasher clip single FBA",
        price=8.99,
        grams=8,
        print_minutes=25,
        filament_per_kg=24,
        fail_rate=0.12,
        ship_weight_oz=2,
        channel="fba",
        tacoss=0.15,
        return_rate=0.12,
        labor_minutes=8,
        packaging=0.40,
    ),
]


def main() -> None:
    parser = argparse.ArgumentParser(description="Print planning unit economics")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    rows = [evaluate(**example) for example in EXAMPLES]
    if args.json:
        print(json.dumps(rows, indent=2))
        return
    for row in rows:
        print(f"== {row['name']} ({row['channel']}) ==")
        for key, value in row.items():
            if key in ("name", "channel"):
                continue
            print(f"  {key}: {value}")
        print()


if __name__ == "__main__":
    main()
