"""Locks the teaching examples. Run: python3 playbook/tools/test_unit_economics.py"""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from unit_economics import EXAMPLES, evaluate


def main() -> None:
    rows = {row["name"]: row for row in (evaluate(**example) for example in EXAMPLES)}
    bad = rows["BAD commodity organizer"]
    excellent = rows["EXCELLENT small high-price part"]
    killed = rows["KILLED dishwasher clip single FBA"]
    knob = rows["CASE STUDY cycle knob Amazon FBM"]
    assert bad["contribution_after_owner_labor"] < 0
    assert bad["cash_profit_per_printer_hour"] < 15
    assert excellent["cash_profit_per_printer_hour"] > 40
    assert excellent["contribution_after_owner_labor"] > 12
    assert killed["cash_profit_per_printer_hour"] < 15
    assert knob["cash_profit_per_printer_hour"] > 25
    assert knob["contribution_after_owner_labor"] > 10
    print("unit economics examples still match the playbook gates")


if __name__ == "__main__":
    main()
