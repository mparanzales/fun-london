#!/usr/bin/env python3
"""
Fun London — OneZone restaurant import.

Reads the OneZone Excel export and inserts all fully-tagged places into
public.pending_candidates (status='pending') so they appear in /admin/candidates
for review before going live.

Run:
  python3 scripts/import-onezone.py --dry-run   # print what would be inserted
  python3 scripts/import-onezone.py             # write to Supabase

Requires:
  pip install pandas openpyxl requests
  .env.local must have NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import pandas as pd
import requests

# ── Config ───────────────────────────────────────────────────────────────────

EXCEL_PATH = Path(__file__).parent.parent / "scripts" / "onezone_restaurants.xlsx"
# Also accept the file from Downloads if not copied yet
FALLBACK_PATH = Path.home() / "Downloads" / "onezone_restaurants.xlsx"

AREA_WORDS = {
    "aldgate", "balham", "battersea", "belgravia", "bloomsbury",
    "clapham", "covent garden", "earls court", "embankment", "fitzrovia",
    "hammersmith", "highgate", "holborn", "kensington", "kings cross",
    "knightsbridge", "ladbroke grove", "marylebone", "notting hill",
    "paddington", "pimlico", "putney", "queens park", "shepherds bush",
    "shepherd's bush", "soho", "south bank", "south kensington",
    "southbank", "st james", "st johns wood", "temple", "victoria",
    "west hampstead", "white city", "westminster",
}

# OneZone region → Fun London region
REGION_MAP = {
    "Central London": "Central",
    "City of London": "Central",
    "North London": "North",
    "South London": "South",
    "West London": "West",
    # East London venues appear in OneZone areas but not as a named region
}

# OneZone cuisine type → Fun London VenueType (best-effort)
CUISINE_TO_TYPE = {
    "British": "Restaurant", "European": "Restaurant", "French": "Restaurant",
    "Italian": "Restaurant", "Spanish": "Restaurant", "Greek": "Restaurant",
    "Indian": "Restaurant", "Japanese": "Restaurant", "Chinese": "Restaurant",
    "Korean": "Restaurant", "Thai": "Restaurant", "Vietnamese": "Restaurant",
    "Mexican": "Restaurant", "Peruvian": "Restaurant", "Middle Eastern": "Restaurant",
    "Mediterranean": "Restaurant", "American": "Restaurant", "Australian": "Restaurant",
    "Global": "Restaurant", "Latin American": "Restaurant", "West African": "Restaurant",
    "Seafood": "Restaurant", "Steak": "Restaurant", "Sushi": "Restaurant",
    "Pizza": "Restaurant", "Pasta": "Restaurant", "Ramen": "Restaurant",
    "Noodles": "Restaurant", "Dim Sum": "Restaurant", "Omakase": "Restaurant",
    "Tapas": "Restaurant", "Georgian": "Restaurant", "Nordic": "Restaurant",
    "Lebanese": "Restaurant", "Persian": "Restaurant", "Turkish": "Restaurant",
    "Filipino": "Restaurant", "Malaysian": "Restaurant", "Singaporean": "Restaurant",
    "Taiwanese": "Restaurant", "Sri Lankan": "Restaurant", "Caribbean": "Restaurant",
    "Ukrainian": "Restaurant", "South African": "Restaurant", "Swedish": "Restaurant",
    "Portuguese": "Restaurant", "Jewish": "Restaurant",
    "Gastropub": "Pub",
    "Beer": "Pub", "Guinness": "Pub",
    "Craft Beer": "Bar",
    "Wine": "Wine Bar",
    "Natural Wine": "Wine Bar",
    "Cocktail": "Bar",
    "Bakery": "Cafe", "Pastries": "Cafe", "Cake": "Cafe",
    "Coffee": "Cafe", "Matcha": "Cafe",
    "Ice cream": "Cafe",
    "Sandwiches": "Cafe", "Deli": "Cafe",
    "Salads": "Cafe", "Healthy": "Cafe", "Smoothies": "Cafe",
    "Juice": "Cafe",
    "Vegan": "Restaurant", "Vegetarian": "Restaurant",
    "Burgers": "Restaurant", "Fried Chicken": "Restaurant",
    "Chicken": "Restaurant", "BBQ": "Restaurant", "Charcoal Grill": "Restaurant",
    "Ceviche": "Restaurant", "Oysters": "Restaurant", "Lobster": "Restaurant",
    "Kebab": "Restaurant", "Tacos": "Restaurant", "Street Food": "Market",
    "Poke": "Cafe", "Acai": "Cafe", "Cheese": "Cafe",
    "Hawaiian": "Restaurant", "Pan Asian": "Restaurant", "Asian": "Restaurant",
    "Charcuterie": "Restaurant", "Meat": "Restaurant", "Fish": "Restaurant",
    "Doughnut": "Cafe", "Sourdough": "Cafe", "Sweet": "Cafe",
    "Bagel": "Cafe", "Pancakes": "Cafe",
    "Gluten Free": "Restaurant", "Whisky": "Bar",
    "Mezcal": "Bar", "Beer": "Bar",
}


def is_area_name(value: str) -> bool:
    if not value:
        return False
    return value.lower().strip() in AREA_WORDS


def split_tags(value) -> list[str]:
    if pd.isna(value) or not str(value).strip():
        return []
    return [t.strip() for t in str(value).split(";") if t.strip()]


def load_env() -> tuple[str, str]:
    env_path = Path(__file__).parent.parent / ".env.local"
    env = {}
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    return url, key


def build_record(row: pd.Series) -> dict:
    name = str(row["Restaurant Name"]).strip()
    area = str(row["Area"]).strip() if pd.notna(row["Area"]) else ""
    region_raw = str(row["London Region"]).strip() if pd.notna(row["London Region"]) else ""
    cuisine_raw = str(row["Cuisine Type"]).strip() if pd.notna(row["Cuisine Type"]) else ""

    # Cuisine type cleanup — OneZone sometimes puts the area name in this field
    cuisine = cuisine_raw if not is_area_name(cuisine_raw) else ""
    type_guess = CUISINE_TO_TYPE.get(cuisine) if cuisine else None

    raw_tags = split_tags(row.get("Tags"))
    cuisine_lists = split_tags(row.get("Cuisines Lists"))
    occasion_lists = split_tags(row.get("Occasions Lists"))
    vibe_lists = split_tags(row.get("Vibes Lists"))
    top_lists = split_tags(row.get("Top Lists"))

    # vibe_tags_draft: merge free-form tags + vibe lists (deduplicated)
    vibe_tags = list(dict.fromkeys(raw_tags + vibe_lists))

    # neighbourhood: use the OneZone area as-is (admin can refine)
    neighbourhood = area

    sources = [{
        "source": "onezone",
        "cuisine_type": cuisine or None,
        "cuisine_lists": cuisine_lists,
        "occasion_lists": occasion_lists,
        "vibe_lists": vibe_lists,
        "top_lists": top_lists,
        "london_region": REGION_MAP.get(region_raw, region_raw) or None,
    }]

    return {
        "name": name,
        "neighbourhood": neighbourhood,
        "type_guess": type_guess,
        "sources": sources,
        "sources_count": 1,
        "vibe_tags_draft": vibe_tags or None,
        "status": "pending",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--file", default=None, help="Path to the OneZone Excel file")
    args = parser.parse_args()

    # Locate the Excel file
    excel_path = Path(args.file) if args.file else (
        EXCEL_PATH if EXCEL_PATH.exists() else FALLBACK_PATH
    )
    if not excel_path.exists():
        print(f"ERROR: Excel file not found at {excel_path}")
        print("Either copy it to scripts/onezone_restaurants.xlsx or pass --file <path>")
        sys.exit(1)

    print(f"Reading {excel_path} …")
    df = pd.read_excel(excel_path, sheet_name="Restaurants")

    # Only rows with complete location data
    complete = df[df["Area"].notna()].copy()
    print(f"  Total rows: {len(df)} | With location data: {len(complete)}")

    records = [build_record(row) for _, row in complete.iterrows()]
    print(f"  Records to insert: {len(records)}")

    if args.dry_run:
        print("\n── DRY RUN (first 5 records) ──")
        for r in records[:5]:
            print(json.dumps(r, indent=2, ensure_ascii=False))
        print(f"\n(Would insert {len(records)} records into pending_candidates)")
        return

    supabase_url, service_key = load_env()
    if not supabase_url or not service_key:
        print("ERROR: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
        sys.exit(1)

    # Fetch existing candidate names to avoid duplicates
    print("\nChecking existing candidates …")
    existing_resp = requests.get(
        f"{supabase_url}/rest/v1/pending_candidates",
        params={"select": "name", "limit": 5000},
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )
    existing_resp.raise_for_status()
    existing_names = {r["name"].lower().strip() for r in existing_resp.json()}
    print(f"  Existing candidates: {len(existing_names)}")

    # Also fetch existing venue names
    venues_resp = requests.get(
        f"{supabase_url}/rest/v1/venues",
        params={"select": "name", "limit": 5000},
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )
    venues_resp.raise_for_status()
    venue_names = {r["name"].lower().strip() for r in venues_resp.json()}
    print(f"  Existing venues: {len(venue_names)}")

    skip_names = existing_names | venue_names
    new_records = [r for r in records if r["name"].lower().strip() not in skip_names]
    print(f"  New (not already in DB): {len(new_records)}")

    if not new_records:
        print("Nothing to insert — all OneZone places are already in the DB.")
        return

    # Insert in batches of 200
    BATCH = 200
    inserted = 0
    for i in range(0, len(new_records), BATCH):
        batch = new_records[i : i + BATCH]
        resp = requests.post(
            f"{supabase_url}/rest/v1/pending_candidates",
            json=batch,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
        )
        if not resp.ok:
            print(f"ERROR on batch {i//BATCH + 1}: {resp.status_code} {resp.text}")
            sys.exit(1)
        inserted += len(batch)
        print(f"  Inserted batch {i//BATCH + 1} ({inserted}/{len(new_records)})")

    print(f"\nDone. {inserted} OneZone places added to pending_candidates.")
    print("Review them at /admin/candidates → approve to push live.")


if __name__ == "__main__":
    main()
