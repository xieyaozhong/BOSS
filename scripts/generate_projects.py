#!/usr/bin/env python3
"""Build a safe, static GitHub portfolio catalog for the BOSS dashboard."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config" / "project-overrides.json"
DEFAULT_OUTPUT = ROOT / "site" / "data" / "github-projects.json"
API_ROOT = "https://api.github.com"
HEX_COLOR = re.compile(r"^#[0-9a-f]{6}$", re.I)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    require(config.get("schemaVersion") == 1, "project override schemaVersion must be 1")
    require(isinstance(config.get("owner"), str) and config["owner"], "project owner is required")
    require(type(config.get("publishUncurated")) is bool, "publishUncurated must be boolean")
    categories = config.get("categories")
    require(isinstance(categories, list) and categories, "project categories are required")
    category_ids = [item.get("id") for item in categories]
    require(len(category_ids) == len(set(category_ids)), "project category ids must be unique")
    require("other" in category_ids, "project categories need an 'other' fallback")
    require(all(isinstance(item.get("label"), str) and item["label"].strip() for item in categories), "category labels are required")
    projects = config.get("projects")
    require(isinstance(projects, dict), "project overrides must be an object")
    featured_ranks: set[int] = set()
    icons: set[str] = set()
    for slug, override in projects.items():
        require(isinstance(slug, str) and slug, "project override slugs cannot be empty")
        require(isinstance(override, dict), f"override for {slug} must be an object")
        require(override.get("category") in category_ids, f"invalid category for {slug}")
        require(isinstance(override.get("purpose"), str) and 8 <= len(override["purpose"].strip()) <= 180, f"invalid purpose for {slug}")
        require(isinstance(override.get("icon"), str) and 1 <= len(override["icon"].strip()) <= 3, f"invalid icon for {slug}")
        require(override["icon"] not in icons, f"duplicate project icon: {override['icon']}")
        icons.add(override["icon"])
        require(isinstance(override.get("accent"), str) and HEX_COLOR.fullmatch(override["accent"]), f"invalid accent for {slug}")
        title = override.get("title")
        require(title is None or (isinstance(title, str) and 1 <= len(title.strip()) <= 120), f"invalid title for {slug}")
        caution = override.get("caution")
        require(caution is None or (isinstance(caution, str) and 4 <= len(caution.strip()) <= 160), f"invalid caution for {slug}")
        live_url = override.get("liveUrl")
        require(live_url is None or safe_https_url(live_url) is not None, f"invalid liveUrl for {slug}")
        rank = override.get("featuredRank")
        require(rank is None or (type(rank) is int and rank > 0), f"invalid featuredRank for {slug}")
        if rank is not None:
            require(rank not in featured_ranks, f"duplicate featuredRank: {rank}")
            featured_ranks.add(rank)
    return config


def fetch_repositories(owner: str, token: str | None = None) -> list[dict[str, Any]]:
    repositories: list[dict[str, Any]] = []
    page = 1
    while True:
        query = urlencode({"type": "owner", "sort": "updated", "direction": "desc", "per_page": 100, "page": page})
        request = Request(
            f"{API_ROOT}/users/{owner}/repos?{query}",
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "BOSS-portfolio-sync"
            }
        )
        if token:
            request.add_header("Authorization", f"Bearer {token}")
        with urlopen(request, timeout=30) as response:
            payload = json.load(response)
        require(isinstance(payload, list), "GitHub repositories response must be a list")
        repositories.extend(payload)
        if len(payload) < 100:
            break
        page += 1
    return repositories


def fallback_icon(slug: str) -> str:
    compact = "".join(character for character in slug if character.isalnum())
    return (compact[:2] or "<>").upper()


def safe_https_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value.startswith("https://") else None


def build_catalog(
    repositories: list[dict[str, Any]],
    config: dict[str, Any],
    generated_at: str | None = None
) -> dict[str, Any]:
    owner = config["owner"]
    overrides = config["projects"]
    category_labels = {item["id"]: item["label"] for item in config["categories"]}
    projects: list[dict[str, Any]] = []
    reserved_icons = {override["icon"] for override in overrides.values()}
    used_icons: set[str] = set()
    pending_count = 0

    for repository in repositories:
        if repository.get("fork") is True or repository.get("private") is True:
            continue
        slug = repository.get("name")
        if not isinstance(slug, str) or not slug:
            continue
        repo_owner = repository.get("owner", {}).get("login")
        if repo_owner and repo_owner.casefold() != owner.casefold():
            continue
        override = overrides.get(slug, {})
        if not override and not config["publishUncurated"]:
            pending_count += 1
            continue
        language = repository.get("language") if isinstance(repository.get("language"), str) else "未標示"
        description = repository.get("description") if isinstance(repository.get("description"), str) else ""
        purpose = override.get("purpose") or description.strip() or f"以 {language} 製作的公開作品，詳細用途待補充。"
        purpose = purpose.strip()
        if len(purpose) > 180:
            purpose = purpose[:179].rstrip() + "…"
        category = override.get("category", "other")
        if category not in category_labels:
            category = "other"
        github_homepage = safe_https_url(repository.get("homepage"))
        live_url = safe_https_url(override.get("liveUrl")) or github_homepage
        updated_at = repository.get("updated_at") if isinstance(repository.get("updated_at"), str) else "1970-01-01T00:00:00Z"
        featured_rank = override.get("featuredRank")
        if not isinstance(featured_rank, int) or featured_rank < 1:
            featured_rank = None
        icon = override.get("icon")
        if not icon:
            icon = fallback_icon(slug)
            forbidden_icons = used_icons | reserved_icons
            if icon in forbidden_icons:
                base = icon[:1]
                digest = hashlib.sha256(slug.encode("utf-8")).hexdigest().upper()
                candidates = (f"{base}{digest[index:index + 2]}" for index in range(len(digest) - 1))
                icon = next((candidate for candidate in candidates if candidate not in forbidden_icons), "")
                require(bool(icon), f"could not create a unique icon for {slug}")
        require(icon not in used_icons, f"duplicate generated project icon: {icon}")
        used_icons.add(icon)

        projects.append({
            "repoId": int(repository.get("id", 0)),
            "slug": slug,
            "title": override.get("title") or slug,
            "repoUrl": f"https://github.com/{owner}/{slug}",
            "liveUrl": live_url,
            "purpose": purpose,
            "caution": override.get("caution") if isinstance(override.get("caution"), str) else None,
            "category": category,
            "categoryLabel": category_labels[category],
            "icon": icon,
            "accent": override.get("accent") or "#8fb6ff",
            "language": language,
            "stars": max(0, int(repository.get("stargazers_count", 0))),
            "updatedAt": updated_at,
            "archived": repository.get("archived") is True,
            "template": repository.get("is_template") is True,
            "featured": featured_rank is not None,
            "featuredRank": featured_rank
        })

    projects.sort(key=lambda item: item["updatedAt"], reverse=True)
    projects.sort(key=lambda item: (0 if item["featured"] else 1, item["featuredRank"] or 9999))
    category_counts = {item["id"]: 0 for item in config["categories"]}
    for project in projects:
        category_counts[project["category"]] += 1

    timestamp = generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "schemaVersion": 1,
        "owner": owner,
        "profileUrl": f"https://github.com/{owner}",
        "generatedAt": timestamp,
        "total": len(projects),
        "pendingCount": pending_count,
        "featuredCount": sum(1 for project in projects if project["featured"]),
        "categories": [
            {"id": item["id"], "label": item["label"], "count": category_counts[item["id"]]}
            for item in config["categories"] if category_counts[item["id"]] > 0
        ],
        "projects": projects
    }


def write_catalog(path: Path, catalog: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def catalog_age_hours(path: Path, now: datetime | None = None) -> float:
    payload = json.loads(path.read_text(encoding="utf-8"))
    generated_at = payload.get("generatedAt")
    require(isinstance(generated_at, str), "existing catalog generatedAt is missing")
    generated = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    require(generated.tzinfo is not None, "existing catalog generatedAt needs a timezone")
    reference = now or datetime.now(timezone.utc)
    return max(0.0, (reference - generated.astimezone(timezone.utc)).total_seconds() / 3600)


def emit_warning(message: str) -> None:
    prefix = "::warning::" if os.environ.get("GITHUB_ACTIONS") == "true" else "Warning: "
    print(f"{prefix}{message}", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--fixture", type=Path, help="Use a local GitHub API fixture instead of the network")
    parser.add_argument("--require-fresh", action="store_true", help="Fail instead of preserving an existing catalog when GitHub is unavailable")
    parser.add_argument("--max-stale-hours", type=float, default=36.0, help="Maximum age allowed when preserving a cached catalog")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    require(args.max_stale_hours > 0, "max-stale-hours must be positive")
    config = load_config(args.config)
    try:
        if args.fixture:
            repositories = json.loads(args.fixture.read_text(encoding="utf-8"))
        else:
            token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
            repositories = fetch_repositories(config["owner"], token)
        catalog = build_catalog(repositories, config)
        require(catalog["total"] > 0, "GitHub returned no owned public repositories")
        write_catalog(args.output, catalog)
        print(f"Synced {catalog['total']} GitHub projects for {catalog['owner']} ({catalog['pendingCount']} pending curation)")
    except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError) as error:
        if args.output.exists() and not args.require_fresh:
            try:
                age = catalog_age_hours(args.output)
            except (OSError, ValueError, json.JSONDecodeError):
                age = float("inf")
            if age <= args.max_stale_hours:
                emit_warning(f"GitHub sync unavailable; preserved {age:.1f}h-old catalog ({error.__class__.__name__})")
                return
        raise


if __name__ == "__main__":
    main()
