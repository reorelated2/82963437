import asyncio
import re
from datetime import datetime, timedelta
from pathlib import Path

from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
import pandas as pd

BASE_URL = "https://www.browardclerk.org/Web2"
OUTPUT_DIR = Path(".")


def _format_date(value: datetime) -> str:
    return value.strftime("%m/%d/%Y")


async def _maybe_click(page, name_pattern: str) -> bool:
    locator = page.get_by_role("button", name=re.compile(name_pattern, re.I))
    if await locator.count():
        await locator.first.click()
        return True
    locator = page.get_by_role("link", name=re.compile(name_pattern, re.I))
    if await locator.count():
        await locator.first.click()
        return True
    return False


async def _maybe_fill(page, label_pattern: str, value: str) -> bool:
    locator = page.get_by_label(re.compile(label_pattern, re.I))
    if await locator.count():
        await locator.first.fill(value)
        return True
    return False


async def scrape_broward_foreclosures() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page = await context.new_page()

        print("Navigating to Broward Clerk Web2...")
        await page.goto(BASE_URL, wait_until="domcontentloaded")

        await _maybe_click(page, r"Accept|Agree|Continue")
        await page.wait_for_timeout(1000)

        await _maybe_click(page, r"Case Search")

        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except PlaywrightTimeoutError:
            print("Warning: page load took longer than expected.")

        yesterday = datetime.now() - timedelta(days=1)
        today = datetime.now()

        date_from = _format_date(yesterday)
        date_to = _format_date(today)

        await _maybe_fill(page, r"From Date|Date From|Filed From|Start Date", date_from)
        await _maybe_fill(page, r"To Date|Date To|Filed To|End Date", date_to)

        case_type_selectors = [
            "select#ddlCaseType",
            "select[name*='CaseType']",
            "select[aria-label*='Case Type']",
        ]
        for selector in case_type_selectors:
            if await page.locator(selector).count():
                await page.locator(selector).select_option(label=re.compile("Foreclosure", re.I))
                break

        await _maybe_click(page, r"Search|Submit")

        try:
            await page.wait_for_selector("table", timeout=15000)
        except PlaywrightTimeoutError:
            print("No results table found; please verify selectors for the search page.")
            await browser.close()
            return

        rows = page.locator("table tbody tr")
        row_count = await rows.count()
        print(f"Found {row_count} rows in results table.")

        results = []
        for row_index in range(row_count):
            cells = rows.nth(row_index).locator("td")
            cell_count = await cells.count()
            if cell_count == 0:
                continue

            row_text = [await cells.nth(i).inner_text() for i in range(cell_count)]
            results.append(
                {
                    "raw_text": " | ".join(text.strip() for text in row_text),
                    "scrape_date": datetime.now().strftime("%Y-%m-%d"),
                    "date_from": date_from,
                    "date_to": date_to,
                }
            )

        if results:
            df = pd.DataFrame(results)
            filename = OUTPUT_DIR / f"broward_foreclosures_{datetime.now():%Y%m%d}.csv"
            df.to_csv(filename, index=False)
            print(f"Saved {len(results)} rows to {filename}")
        else:
            print("No results extracted. The selector may need to be updated.")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(scrape_broward_foreclosures())
