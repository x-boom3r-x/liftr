#!/usr/bin/env python3
"""
Build LIFTR's data/exercises-catalogue.json from openGym's catalogue/exercises/.

Usage from the repository root:
    python3 liftr-patch/tools/build-catalogue.py         (writes catalogue and provenance sidecar)
    python3 liftr-patch/tools/build-catalogue.py --check (verifies catalogue and provenance)
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

# Where openGym's real exercise records live (reachable checkout of
# https://github.com/DuarteSantos8/openGym at 8fb98b16...).
OPENGYM = Path(".opengym-ref-v2") / "catalogue/exercises"

# Main exercise records only: files that have a name field are main records;
# the translation/variant entries (no name / variantOf / femaleVariant) are
# deliberately not added as catalogue rows so nothing is duplicated or lost.
CATALOGUE_URL = "https://github.com/DuarteSantos8/openGym/tree/8fb98b16861a2728652302a7e6e30c50548493a0/catalogue/exercises"
PROVENANCE_PATH = Path("data/exercises-catalogue-provenance.json")
SOURCE_TAGS = {"exercisedb", "opengym"}

FIELDS = [
    "id",
    "name",
    "bodyPart",
    "equipment",
    "target",
    "secondaryMuscles",
    "category",
    "description",
    "instructions",
]

# Alias table: french user search term -> original English canonical name.
# The original names are untouched; only the alias lets "développé couché"
# resolve to "Bench Press".
FR_TO_EN = {
    "développé couché": "bench press",
    "développé couché sur banc": "bench press",
    "squat": "squat",
    "squat barbell": "squat",
    "squat contremaison": "squat",
    "squat goblet": "squat",
    "squats": "squat",
    "squat avec élastique": "squat",
    "élévations latérales": "lateral raise",
    "élévations latérales sitzt": "lateral raise",
    "lévées latérales": "lateral raise",
    "tirage vertical": "lat pulldown",
    "tirage vertical ouvert": "lat pulldown",
    "tirage vertical fermé": "lat pulldown",
    "tirage vertical machine": "lat pulldown",
}

# Same aliases, English query -> original name (used for English searches).
EN_TO_EN = {v: v for v in FR_TO_EN.values()}


def read_json(path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def norm_keys(obj):
    """Return a copy of obj with keys in a stable order."""
    return {k: obj[k] for k in FIELDS if k in obj}


def main():
    parser = argparse.ArgumentParser(description="Build the LIFTR openGym catalogue.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify an existing data/exercises-catalogue.json instead of writing it.",
    )
    args = parser.parse_args()

    catalogue_path = Path("data/exercises-catalogue.json")
    if not args.check:
        if not OPENGYM.exists():
            sys.stderr.write(
                "openGym catalogue not found at %s; point OPENGYM at the checkout.\n"
                % OPENGYM
            )
            sys.exit(1)

        # 1. Read every main record (files with a `name` field) in id order.
        ids = sorted(p.stem for p in OPENGYM.glob("*.json") if (read_json(p).get("name")))
        records = []
        provenance_records = {}
        seen = set()
        for ex_id in ids:
            rec = read_json(OPENGYM / f"{ex_id}.json")
            source_tag = rec.get("textSource")
            if source_tag not in SOURCE_TAGS:
                sys.stderr.write(f"Unknown or missing textSource for exercise {ex_id}: {source_tag!r}\n")
                sys.exit(1)
            provenance_records[ex_id] = source_tag
            # Unique ids only; a duplicate id means the file is a variant
            # record already carried by another main record.
            if ex_id in seen:
                continue
            seen.add(ex_id)
            records.append(norm_keys(rec))

        # 2. Attach the aliases the UI needs (original names untouched).
        for rec in records:
            rec["aliases_fr"] = [FR_TO_EN.get(w, w) for w in
                                 FR_TO_EN if FR_TO_EN[w] == rec["name"]] or None
            rec["aliases_en"] = [EN_TO_EN.get(w, w) for w in
                                 EN_TO_EN if EN_TO_EN[w] == rec["name"]] or None

        # 3. Write the catalogue object (count + records[]).
        catalogue = {
            "source": str(CATALOGUE_URL),
            "size": "openGym",
            "count": len(records),
            "records": records,
        }
        catalogue_path.parent.mkdir(parents=True, exist_ok=True)
        catalogue_path.write_text(
            json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(f"Wrote {catalogue_path} with {len(records)} records.")

        # Keep openGym's per-record source tags in a sidecar so the shipped
        # catalogue payload and its existing consumers remain unchanged.
        # NOTICE.md explains the field-level licence boundaries.
        provenance = {
            "source": "openGym",
            "sourceCommit": "8fb98b16861a2728652302a7e6e30c50548493a0",
            "sourceUrl": CATALOGUE_URL,
            "tagField": "textSource",
            "records": {rec["id"]: provenance_records[rec["id"]] for rec in records},
            "counts": dict(Counter(provenance_records.values())),
        }
        PROVENANCE_PATH.write_text(
            json.dumps(provenance, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        print(f"Wrote {PROVENANCE_PATH} with {len(provenance_records)} source tags.")
    else:
        # --- integrity check against the same expected shape -----------
        if not catalogue_path.exists():
            sys.stderr.write("data/exercises-catalogue.json does not exist yet.\n")
            sys.exit(1)
        data = json.loads(catalogue_path.read_text(encoding="utf-8"))
        if not PROVENANCE_PATH.exists():
            sys.stderr.write(f"{PROVENANCE_PATH} does not exist yet.\n")
            sys.exit(1)
        provenance = json.loads(PROVENANCE_PATH.read_text(encoding="utf-8"))
        n = data.get("count")
        records = data.get("records", [])
        ids = [r.get("id") for r in records]
        dup = len(ids) - len(set(ids))

        source_tags = provenance.get("records", {})
        source_counts = dict(Counter(source_tags.values()))
        unknown_tags = sorted(set(source_tags.values()) - SOURCE_TAGS)
        missing_provenance_ids = sorted(set(ids) - set(source_tags))
        extra_provenance_ids = sorted(set(source_tags) - set(ids))
        provenance_ok = (
            provenance.get("source") == "openGym"
            and provenance.get("sourceCommit") == "8fb98b16861a2728652302a7e6e30c50548493a0"
            and provenance.get("sourceUrl") == CATALOGUE_URL
            and provenance.get("tagField") == "textSource"
            and not missing_provenance_ids
            and not extra_provenance_ids
            and not unknown_tags
            and source_counts == {"exercisedb": 1324, "opengym": 4308}
            and provenance.get("counts") == source_counts
        )

        missing_fields = []
        for i, r in enumerate(records):
            for f in FIELDS:
                if f not in r or r[f] in (None, ""):
                    missing_fields.append((i, f))
                    break

        ok = (
            n == len(records) == 5632
            and dup == 0
            and not missing_fields
            and data.get("source")
            and data.get("size") == "openGym"
            and provenance_ok
        )
        print(f"catalogue.count          = {n}")
        print(f"records array len        = {len(records)}")
        print(f"deduped ids              = {len(set(ids))}")
        print(f"duplicate ids            = {dup}")
        print(f"records missing fields   = {len(missing_fields)} {missing_fields[:5]}")
        print(f"source field present     = {bool(data.get('source'))}")
        print(f"size field == 'openGym'  = {data.get('size') == 'openGym'}")
        print(f"source tags              = {source_counts}")
        print(f"missing provenance ids   = {len(missing_provenance_ids)}")
        print(f"extra provenance ids     = {len(extra_provenance_ids)}")
        print(f"provenance sidecar valid = {provenance_ok}")
        print("INTEGRITY CHECK: " + ("PASS" if ok else "FAIL"))
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
