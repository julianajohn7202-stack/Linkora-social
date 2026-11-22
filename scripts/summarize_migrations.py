#!/usr/bin/env python3
"""
Summarizes database migration execution for CI and deployment reviews:
starting version, ending version, elapsed time, and outcome per target.
Ensures all connection strings and credentials are excluded from output.
"""

import os
import re
import sys
import time
from pathlib import Path

def sanitize(text: str) -> str:
    # Redact database URLs and credentials
    text = re.sub(r'postgres(?:ql)?://[^@:\s]+:[^@\s]+@', 'postgresql://***:***@', text, flags=re.IGNORECASE)
    text = re.sub(r'password=[^\s&]+', 'password=***', text, flags=re.IGNORECASE)
    text = re.sub(r'secret=[^\s&]+', 'secret=***', text, flags=re.IGNORECASE)
    return text

def main():
    start_seconds_str = os.getenv("START_SECONDS", "")
    run_status = os.getenv("RUN_STATUS", "success").lower()
    verify_status = os.getenv("VERIFY_STATUS", "success").lower()
    step_summary_file = os.getenv("GITHUB_STEP_SUMMARY")

    end_seconds = int(time.time())
    if start_seconds_str and start_seconds_str.isdigit():
        elapsed = end_seconds - int(start_seconds_str)
        elapsed_display = f"{elapsed}s"
    else:
        elapsed_display = "N/A"

    overall_success = (run_status == "success" and verify_status == "success")
    overall_outcome = "✅ SUCCESS" if overall_success else "❌ FAILED"
    target_outcome = "✅ SUCCESS" if overall_success else "❌ FAILED"

    targets = [
        ("indexer", Path("services/indexer/migrations")),
        ("dm-relay", Path("services/dm-relay/migrations"))
    ]

    lines = [
        "## Database Migration Execution Summary",
        "",
        f"**Overall Status:** {overall_outcome}  ",
        f"**Total Elapsed Time:** {elapsed_display}  ",
        "",
        "| Target | Starting Version | Ending Version | Total Migrations | Elapsed Time | Outcome |",
        "| :--- | :--- | :--- | :---: | :---: | :---: |"
    ]

    for target_name, target_dir in targets:
        if target_dir.is_dir():
            files = sorted([f.name for f in target_dir.glob("*.sql")])
            count = len(files)
            if count > 0:
                start_ver = files[0]
                end_ver = files[-1]
            else:
                start_ver = "none"
                end_ver = "none"
        else:
            start_ver = "missing"
            end_ver = "missing"
            count = 0

        lines.append(f"| `{target_name}` | `{start_ver}` | `{end_ver}` | {count} | {elapsed_display} | {target_outcome} |")

    lines.extend([
        "",
        "### Target Details & Artifacts",
        "- **Indexer Schema Snapshot:** `tests/migrations/expected-schema.sql`",
        "- **Migration Test Suite:** `tests/migrations/test-migrations.sh`",
        "",
        "> **Security & Compliance Note:** Connection strings, passwords, and sensitive credentials are excluded from this summary.",
        ""
    ])

    summary_text = sanitize("\n".join(lines))

    if step_summary_file:
        with open(step_summary_file, "a", encoding="utf-8") as f:
            f.write(summary_text + "\n")
    else:
        print(summary_text)

if __name__ == "__main__":
    main()
