from __future__ import annotations

import argparse
import importlib
import os
import sys
from pathlib import Path
from collections import Counter


VENV_PYTHON = Path(__file__).resolve().parent / ".venv" / "bin" / "python"


def _reexec_in_venv() -> None:
    if not VENV_PYTHON.exists():
        return
    if Path(sys.executable).resolve() == VENV_PYTHON.resolve():
        return
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])


def _add_local_site_packages() -> None:
    lib_dir = Path(__file__).resolve().parent / ".venv" / "lib"
    candidates = sorted(lib_dir.glob("python*/site-packages"), reverse=True)
    for site_packages in candidates:
        site_packages_str = str(site_packages)
        if site_packages.exists() and site_packages_str not in sys.path:
            sys.path.insert(0, site_packages_str)
            break


_reexec_in_venv()
_add_local_site_packages()

from writers import write_csv


BOARD_ADAPTERS = {
    "naukri": "boards.naukri.NaukriAdapter",
    "remoteok": "boards.remoteok.RemoteOKAdapter",
    "wellfound": "boards.wellfound.WellfoundAdapter",
}


def _load_adapter_class(board_name: str):
    module_name, class_name = BOARD_ADAPTERS[board_name].rsplit(".", 1)
    module = importlib.import_module(module_name)
    return getattr(module, class_name)


def _dedupe_rows(rows: list[dict]) -> list[dict]:
    seen: set[tuple[str, str, str, str]] = set()
    deduped: list[dict] = []

    for row in rows:
        key = (
            (row.get("source") or "").strip().casefold(),
            (row.get("title") or "").strip().casefold(),
            (row.get("company") or "").strip().casefold(),
            (row.get("location") or "").strip().casefold(),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)

    return deduped

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Harvest job listings from supported boards.")
    parser.add_argument(
        "--board",
        choices=sorted(BOARD_ADAPTERS),
        default=None,
        help="Job board to query. Omit to query all supported boards and combine results",
    )
    parser.add_argument("--role", required=True, help="Role or title to search for")
    parser.add_argument("--location", default="", help="Location to search in")
    parser.add_argument("--limit", type=int, default=20, help="Maximum number of results to fetch")
    parser.add_argument("--output", default="jobs.csv", help="Output file path or sheet name")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    # Determine which boards to run. If --board is not provided, run all supported adapters.
    if args.board:
        boards_to_run = [args.board]
    else:
        boards_to_run = list(BOARD_ADAPTERS.keys())

    combined_rows: list[dict] = []
    per_board_counts: dict[str, int] = {}

    for board_name in boards_to_run:
        adapter_class = _load_adapter_class(board_name)
        adapter = adapter_class()
        rows = adapter.fetch(args.role, args.location)[: args.limit]
        # Ensure each row has a source field for clarity in the combined CSV
        for r in rows:
            if "source" not in r:
                r["source"] = board_name
        combined_rows.extend(rows)
        per_board_counts[board_name] = len(rows)

    combined_rows = _dedupe_rows(combined_rows)

    # count rows per source for reporting
    counts_by_source = Counter((r.get("source") or "unknown") for r in combined_rows)

    write_csv(combined_rows, args.output)
    total = len(combined_rows)
    if len(boards_to_run) == 1:
        print(f"wrote {total} rows to {args.output}")
    else:
        parts = ", ".join([f"{n}={c}" for n, c in counts_by_source.items()])
        print(f"wrote {total} rows ({parts}) to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())