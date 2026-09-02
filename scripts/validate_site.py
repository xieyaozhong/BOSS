#!/usr/bin/env python3
"""Fail fast when the public dashboard is unsafe, incomplete, or over budget."""

from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

try:
    from generate_daily import validate_profile
except ModuleNotFoundError:
    from scripts.generate_daily import validate_profile


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
TAIPEI = ZoneInfo("Asia/Taipei")
TEXT_SUFFIXES = {".html", ".css", ".js", ".json", ".webmanifest", ".txt", ".xml"}
PUBLIC_SECRET_PATTERNS = {
    "email address": re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"),
    "Taiwan mobile number": re.compile(r"(?<!\d)(?:\+?886[- ]?9|09)\d{8}(?!\d)"),
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b"),
    "GitHub fine-grained token": re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b"),
    "OpenAI-style token": re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b"),
    "Google API token": re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b")
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


class AssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.assets: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        for key in ("href", "src"):
            value = attributes.get(key)
            if value and not value.startswith(("#", "http://", "https://", "mailto:", "data:")):
                self.assets.append(value.split("?", 1)[0].split("#", 1)[0])


def walk_keys(value: Any, path: str = "") -> list[str]:
    keys: list[str] = []
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_path = f"{path}.{key}" if path else key
            keys.append(nested_path)
            keys.extend(walk_keys(nested, nested_path))
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            keys.extend(walk_keys(nested, f"{path}[{index}]"))
    return keys


def validate_plan(plan: dict[str, Any], profile: dict[str, Any], expected_date: date) -> None:
    require(plan.get("schemaVersion") == 1, "plan schemaVersion must be 1")
    require(plan.get("date") == expected_date.isoformat(), f"plan date must be {expected_date.isoformat()}")
    require(plan.get("timezone") == "Asia/Taipei", "plan timezone must be Asia/Taipei")
    require(isinstance(plan.get("effectiveAt"), str), "effectiveAt is required")

    focus = plan.get("focus", {})
    steps = focus.get("steps", [])
    require(isinstance(steps, list) and len(steps) == 3, "daily focus must contain exactly three steps")
    require(all(int(step.get("minutes", 0)) > 0 for step in steps), "all focus steps need positive minutes")
    total = int(focus.get("totalMinutes", 0))
    step_total = sum(int(step["minutes"]) for step in steps)
    require(step_total == total, f"step minutes {step_total} do not equal totalMinutes {total}")

    maintain_minutes = int(plan.get("maintain", {}).get("minutes", -1))
    network_minutes = int(plan.get("network", {}).get("minutes", -1))
    planned_total = total + maintain_minutes + network_minutes
    daily_budget = int(plan.get("dailyBudgetMinutes", 0))
    require(daily_budget == int(profile["profile"]["dailyMinutes"]), "plan budget differs from profile dailyMinutes")
    require(planned_total == daily_budget, f"planned minutes {planned_total} do not equal the daily budget")
    require(total >= int(focus.get("minMinutes", 999)), "selected output does not fit the focus time budget")
    require(1 <= int(focus.get("difficulty", 0)) <= 5, "focus difficulty must be between 1 and 5")
    require(focus.get("skillId") in {"music", "art", "code", "language", "network"}, "invalid focus skillId")
    require(isinstance(focus.get("direction"), str) and focus["direction"].strip(), "focus direction is required")
    require(isinstance(focus.get("tags"), list) and focus["tags"], "focus tags are required")
    deliverable = focus.get("deliverable", {})
    require(isinstance(deliverable.get("title"), str) and deliverable["title"].strip(), "deliverable title is required")
    require(isinstance(deliverable.get("doneWhen"), str) and deliverable["doneWhen"].strip(), "definition of done is required")


def parse_iso_datetime(value: Any, label: str) -> None:
    require(isinstance(value, str) and value, f"{label} is required")
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{label} must be an ISO datetime") from error


def validate_projects(catalog: dict[str, Any]) -> None:
    require(catalog.get("schemaVersion") == 1, "project catalog schemaVersion must be 1")
    require(catalog.get("owner") == "xieyaozhong", "project catalog owner must be xieyaozhong")
    require(catalog.get("profileUrl") == "https://github.com/xieyaozhong", "invalid GitHub profile URL")
    parse_iso_datetime(catalog.get("generatedAt"), "project generatedAt")
    categories = catalog.get("categories")
    projects = catalog.get("projects")
    require(isinstance(categories, list) and categories, "project categories are required")
    require(isinstance(projects, list) and projects, "project catalog cannot be empty")
    require(catalog.get("total") == len(projects), "project total does not match projects")
    require(type(catalog.get("pendingCount")) is int and catalog["pendingCount"] >= 0, "pendingCount must be non-negative")
    require(catalog.get("featuredCount") == sum(project.get("featured") is True for project in projects), "featuredCount is incorrect")

    category_ids: set[str] = set()
    category_counts: dict[str, int] = {}
    for category in categories:
        require(isinstance(category, dict), "project category must be an object")
        category_id = category.get("id")
        require(isinstance(category_id, str) and re.fullmatch(r"[a-z][a-z0-9-]{1,30}", category_id), "invalid project category id")
        require(category_id not in category_ids, f"duplicate project category: {category_id}")
        require(isinstance(category.get("label"), str) and category["label"].strip(), f"category {category_id} needs a label")
        require(type(category.get("count")) is int and category["count"] > 0, f"category {category_id} count must be positive")
        category_ids.add(category_id)
        category_counts[category_id] = 0

    repo_ids: set[int] = set()
    slugs: set[str] = set()
    repo_urls: set[str] = set()
    icons: set[str] = set()
    for project in projects:
        require(isinstance(project, dict), "project entry must be an object")
        repo_id = project.get("repoId")
        slug = project.get("slug")
        require(type(repo_id) is int and repo_id > 0, "project repoId must be positive")
        require(repo_id not in repo_ids, f"duplicate project repoId: {repo_id}")
        require(isinstance(slug, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", slug), f"invalid project slug: {slug}")
        require(slug not in slugs, f"duplicate project slug: {slug}")
        repo_url = project.get("repoUrl")
        require(repo_url == f"https://github.com/xieyaozhong/{slug}", f"invalid repository URL for {slug}")
        require(repo_url not in repo_urls, f"duplicate repository URL: {repo_url}")
        require(isinstance(project.get("title"), str) and 1 <= len(project["title"].strip()) <= 120, f"invalid title for {slug}")
        require(isinstance(project.get("purpose"), str) and 8 <= len(project["purpose"].strip()) <= 180, f"invalid purpose for {slug}")
        caution = project.get("caution")
        require(caution is None or (isinstance(caution, str) and 4 <= len(caution.strip()) <= 160), f"invalid caution for {slug}")
        category_id = project.get("category")
        require(category_id in category_ids, f"invalid category for {slug}")
        require(project.get("categoryLabel") == next(item["label"] for item in categories if item["id"] == category_id), f"category label mismatch for {slug}")
        category_counts[category_id] += 1
        require(isinstance(project.get("icon"), str) and 1 <= len(project["icon"].strip()) <= 3, f"invalid icon for {slug}")
        require(project["icon"] not in icons, f"duplicate project icon: {project['icon']}")
        icons.add(project["icon"])
        require(isinstance(project.get("accent"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", project["accent"]), f"invalid accent for {slug}")
        require(isinstance(project.get("language"), str) and 1 <= len(project["language"]) <= 50, f"invalid language for {slug}")
        require(type(project.get("stars")) is int and project["stars"] >= 0, f"invalid stars for {slug}")
        require(type(project.get("archived")) is bool, f"archived must be boolean for {slug}")
        require(type(project.get("template")) is bool, f"template must be boolean for {slug}")
        require(type(project.get("featured")) is bool, f"featured must be boolean for {slug}")
        rank = project.get("featuredRank")
        require(rank is None or (type(rank) is int and rank > 0), f"invalid featured rank for {slug}")
        require((rank is not None) == project["featured"], f"featured rank mismatch for {slug}")
        parse_iso_datetime(project.get("updatedAt"), f"updatedAt for {slug}")
        live_url = project.get("liveUrl")
        if live_url is not None:
            parsed = urlparse(live_url)
            require(parsed.scheme == "https" and bool(parsed.netloc), f"invalid liveUrl for {slug}")
        repo_ids.add(repo_id)
        slugs.add(slug)
        repo_urls.add(repo_url)

    for category_id, expected in category_counts.items():
        declared = next(item["count"] for item in categories if item["id"] == category_id)
        require(expected == declared, f"category count mismatch for {category_id}")


def validate_assets() -> None:
    index = SITE / "index.html"
    require(index.exists(), "site/index.html is missing")
    index_text = index.read_text(encoding="utf-8")
    parser = AssetParser()
    parser.feed(index_text)
    missing: list[str] = []
    for asset in parser.assets:
        clean = asset.removeprefix("./")
        target = (SITE / clean).resolve()
        if SITE.resolve() not in target.parents and target != SITE.resolve():
            missing.append(f"unsafe path: {asset}")
        elif not target.exists():
            missing.append(asset)
    require(not missing, f"missing or unsafe assets: {', '.join(missing)}")

    html_id_list = re.findall(r'\bid="([A-Za-z][A-Za-z0-9_-]*)"', index_text)
    html_ids = set(html_id_list)
    require(len(html_ids) == len(html_id_list), "HTML ids must be unique")
    hash_targets = set(re.findall(r'href="#([A-Za-z][A-Za-z0-9_-]*)"', index_text))
    require(hash_targets <= html_ids, f"navigation points to missing ids: {', '.join(sorted(hash_targets - html_ids))}")
    app_text = (SITE / "assets" / "app.js").read_text(encoding="utf-8")
    required_ids = set(re.findall(r'\$\("#([A-Za-z][A-Za-z0-9_-]*)"', app_text))
    missing_ids = sorted(required_ids - html_ids)
    require(not missing_ids, f"JavaScript references missing HTML ids: {', '.join(missing_ids)}")

    for path in SITE.rglob("*"):
        require(not path.is_symlink(), f"published symlinks are not allowed: {path.relative_to(SITE)}")
        if path.is_file():
            require(not path.name.startswith("."), f"unexpected hidden file in publication: {path.relative_to(SITE)}")


def validate_public_content(profile: dict[str, Any]) -> None:
    forbidden_keys = re.compile(r"(^|\.)(email|phone|address|contactName|realName|token|secret|apiKey)$", re.I)
    leaked = [key for key in walk_keys(profile) if forbidden_keys.search(key)]
    require(not leaked, f"public profile contains sensitive keys: {', '.join(leaked)}")

    for public_root in (SITE, ROOT / "config"):
        for path in public_root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8")
            for label, pattern in PUBLIC_SECRET_PATTERNS.items():
                require(not pattern.search(text), f"possible {label} in public file {path.relative_to(ROOT)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-date", default=datetime.now(TAIPEI).date().isoformat())
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    expected_date = date.fromisoformat(args.expected_date)
    plan = json.loads((SITE / "data" / "today.json").read_text(encoding="utf-8"))
    profile = json.loads((SITE / "data" / "profile.json").read_text(encoding="utf-8"))
    projects = json.loads((SITE / "data" / "github-projects.json").read_text(encoding="utf-8"))
    validate_profile(profile)
    validate_plan(plan, profile, expected_date)
    validate_projects(projects)
    validate_assets()
    validate_public_content(profile)
    require((SITE / "assets" / "og.png").stat().st_size > 10_000, "social preview image is missing or too small")
    print("Site validation passed")


if __name__ == "__main__":
    main()
