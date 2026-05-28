from __future__ import annotations

import csv
from pathlib import Path


def write_csv(rows: list[dict], output_path: str | Path) -> None:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["source", "title", "company", "location", "link", "posted_at"]

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def write_google_sheets(rows: list[dict], sheet_name: str) -> None:
    raise NotImplementedError