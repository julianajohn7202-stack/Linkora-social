#!/usr/bin/env python3
"""
Validates repository-relative documentation links and anchors in Markdown files.
Ensures:
  1. A missing referenced file fails with the source path.
  2. Valid links containing spaces or anchors are resolved correctly.
"""

import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

def generate_slug_variants(text: str) -> Set[str]:
    """Generate GitHub-compatible markdown anchor slugs from heading text."""
    variants = set()
    raw = text.strip().lower()
    # Remove markdown link formatting e.g. [text](url) -> text
    raw = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', raw)
    # Remove code ticks, asterisks, formatting
    raw = re.sub(r'[`*_~]', '', raw)
    # Remove HTML tags
    raw = re.sub(r'<[^>]+>', '', raw)
    # Strip symbols/punctuation except word chars, whitespace, and hyphens
    cleaned = re.sub(r'[^\w\s-]', '', raw)

    # Variant 1: replace each space with a hyphen (preserves multiple dashes from stripped em-dashes)
    slug_spaces = re.sub(r'\s', '-', cleaned).strip('-')
    if slug_spaces:
        variants.add(slug_spaces)

    # Variant 2: collapse consecutive hyphens
    slug_collapsed = re.sub(r'-+', '-', slug_spaces).strip('-')
    if slug_collapsed:
        variants.add(slug_collapsed)

    return variants

def extract_anchors(content: str) -> Set[str]:
    """Extract all valid anchor identifiers from a Markdown document."""
    anchors: Set[str] = set()
    heading_counts: Dict[str, int] = {}

    for line in content.splitlines():
        trimmed = line.strip()
        # Headings: # Heading
        m = re.match(r'^#{1,6}\s+(.+)$', trimmed)
        if m:
            raw_title = m.group(1).strip()
            # Custom heading anchor {#custom-anchor}
            custom_id = re.search(r'\{#([^\}]+)\}$', raw_title)
            if custom_id:
                cid = custom_id.group(1).strip()
                anchors.add(cid)
                anchors.update(generate_slug_variants(cid))
                raw_title = re.sub(r'\{#[^\}]+\}$', '', raw_title).strip()

            slug_variants = generate_slug_variants(raw_title)
            for slug in slug_variants:
                count = heading_counts.get(slug, 0)
                heading_counts[slug] = count + 1
                if count > 0:
                    anchors.add(f"{slug}-{count}")
                else:
                    anchors.add(slug)

    # HTML id and name attributes (e.g. <a id="...">, <div id="...">, <a name="...">)
    for m in re.finditer(r'<[a-zA-Z0-9_-]+[^>]*(?:id|name)=["\']([^"\']+)["\']', content, re.IGNORECASE):
        tag_id = m.group(1).strip()
        anchors.add(tag_id)
        anchors.update(generate_slug_variants(tag_id))

    return anchors

def find_markdown_links(line: str) -> List[str]:
    """Extract all link destination URLs from a single line of Markdown."""
    urls = []
    # Standard Markdown [text](target)
    for m in re.finditer(r'\[([^\]]*)\]\(([^)]+)\)', line):
        urls.append(m.group(2).strip().strip('<>'))
    # Markdown link references [ref]: target
    m_ref = re.match(r'^\s*\[[^\]]+\]:\s*(\S+)', line)
    if m_ref:
        urls.append(m_ref.group(1).strip().strip('<>'))
    return urls

def validate_links(root_dir: Path, target_globs: Optional[List[str]] = None) -> List[str]:
    """
    Validates internal repository-relative links and anchors in Markdown files.
    Returns list of error messages.
    """
    if target_globs is None:
        target_globs = ["docs/**/*.md", "packages/sdk/**/*.md", "*.md"]

    md_files: List[Path] = []
    for pattern in target_globs:
        md_files.extend(root_dir.glob(pattern))

    # Exclude build artifacts and dependencies
    md_files = [
        f for f in md_files
        if 'node_modules' not in f.parts and 'dist' not in f.parts and '.git' not in f.parts
    ]

    errors: List[str] = []
    anchor_cache: Dict[Path, Set[str]] = {}

    for md_file in sorted(md_files):
        rel_source = md_file.relative_to(root_dir)
        try:
            content = md_file.read_text(encoding='utf-8')
        except Exception as e:
            errors.append(f"{rel_source}: failed to read file: {e}")
            continue

        for line_no, line in enumerate(content.splitlines(), start=1):
            links = find_markdown_links(line)
            for raw_url in links:
                # Ignore external URLs, protocols, and mailto
                if re.match(r'^(https?://|mailto:|ftp:|data:|javascript:)', raw_url, re.IGNORECASE):
                    continue

                # Unquote URL (handles spaces e.g. %20 or raw spaces)
                decoded_url = urllib.parse.unquote(raw_url).strip()
                if not decoded_url:
                    continue

                # Separate file path and anchor
                if '#' in decoded_url:
                    path_part, anchor = decoded_url.split('#', 1)
                else:
                    path_part, anchor = decoded_url, None

                path_part = path_part.split('?')[0].strip()

                # Determine target file
                if not path_part:
                    target_file = md_file
                elif path_part.startswith('/'):
                    target_file = (root_dir / path_part.lstrip('/')).resolve()
                else:
                    target_file = (md_file.parent / path_part).resolve()

                # Check if referenced file exists
                if path_part:
                    if not target_file.exists():
                        errors.append(
                            f"{rel_source}:{line_no}: missing referenced file '{path_part}' (resolved: '{target_file}')"
                        )
                        continue

                # If anchor is present and target file is a markdown file, verify anchor exists
                if anchor and target_file.is_file() and target_file.suffix.lower() == '.md':
                    if target_file not in anchor_cache:
                        try:
                            t_content = target_file.read_text(encoding='utf-8')
                            anchor_cache[target_file] = extract_anchors(t_content)
                        except Exception as e:
                            errors.append(f"{rel_source}:{line_no}: failed to read target '{target_file}': {e}")
                            continue

                    available_anchors = anchor_cache[target_file]
                    clean_anchor = anchor.strip().lower()
                    slug_variants = generate_slug_variants(anchor)

                    if (clean_anchor not in available_anchors and
                        anchor not in available_anchors and
                        not any(v in available_anchors for v in slug_variants)):
                        errors.append(
                            f"{rel_source}:{line_no}: missing anchor '#{anchor}' in '{target_file.relative_to(root_dir)}'"
                        )

    return errors

def run_self_tests(tmp_path: Path):
    """Self-test verifying the criteria:
       - A missing referenced file fails with the source path.
       - Valid links containing spaces or anchors are resolved correctly.
    """
    test_dir = tmp_path / "test_docs"
    test_dir.mkdir(parents=True, exist_ok=True)

    # 1. Target file with heading and spaces in filename
    target_spaced = test_dir / "target guide with spaces.md"
    target_spaced.write_text(
        "# Target Guide Header\n\n## Sub Section (Detailed)\n\n## Quickstart — 5 minutes\n",
        encoding="utf-8"
    )

    # 2. Source file with valid links (encoded space, raw space, anchor) and 1 broken link
    source_file = test_dir / "source.md"
    source_file.write_text(
        "# Source Document\n\n"
        "- [Valid link with encoded space](./target%20guide%20with%20spaces.md)\n"
        "- [Valid link with anchor](./target%20guide%20with%20spaces.md#sub-section-detailed)\n"
        "- [Valid link with double dash anchor](./target%20guide%20with%20spaces.md#quickstart--5-minutes)\n"
        "- [Valid internal anchor](#source-document)\n"
        "- [Broken link](./missing-file.md)\n"
        "- [Broken anchor](./target%20guide%20with%20spaces.md#nonexistent-anchor)\n",
        encoding="utf-8"
    )

    errs = validate_links(tmp_path, [f"{test_dir.name}/**/*.md"])

    # Expect exactly 2 errors: 1 missing file and 1 missing anchor
    assert any("missing referenced file './missing-file.md'" in e and "source.md" in e for e in errs), \
        f"Expected missing referenced file error with source path, got: {errs}"
    assert any("missing anchor '#nonexistent-anchor'" in e and "source.md" in e for e in errs), \
        f"Expected missing anchor error with source path, got: {errs}"

    # Verify that valid space link and valid anchor did NOT produce errors
    assert not any("target guide with spaces.md" in e and ("sub-section-detailed" in e or "quickstart" in e) for e in errs), \
        "Valid link with space and anchor should not produce error"

    print("✅ Self-test passed: spaces, anchors, and missing file error reporting verified.")

def main():
    root = Path('.').resolve()

    if "--test" in sys.argv:
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            run_self_tests(Path(td))
        return

    print("Validating repository-relative documentation links and anchors...")
    errors = validate_links(root)

    if errors:
        print(f"\n❌ Found {len(errors)} broken documentation link(s):")
        for err in errors:
            print(f"  {err}")
        sys.exit(1)
    else:
        print("✅ All documentation links and anchors resolved successfully.")

if __name__ == "__main__":
    main()
