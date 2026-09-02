from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from scripts.generate_projects import build_catalog, catalog_age_hours, fallback_icon, load_config


def repository(
    repo_id: int,
    name: str,
    *,
    updated_at: str,
    description: str | None = None,
    language: str | None = "JavaScript",
    owner: str = "xieyaozhong",
    fork: bool = False,
    private: bool = False,
    homepage: str | None = None
) -> dict:
    return {
        "id": repo_id,
        "name": name,
        "owner": {"login": owner},
        "updated_at": updated_at,
        "description": description,
        "language": language,
        "fork": fork,
        "private": private,
        "homepage": homepage,
        "archived": False,
        "is_template": False,
        "stargazers_count": 2
    }


class ProjectCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = {
            "schemaVersion": 1,
            "owner": "xieyaozhong",
            "publishUncurated": True,
            "categories": [
                {"id": "system", "label": "系統・自動化"},
                {"id": "tools", "label": "生活・工具"},
                {"id": "other", "label": "其他作品"}
            ],
            "projects": {
                "BOSS": {
                    "title": "BOSS 能力作業系統",
                    "icon": "BO",
                    "accent": "#8fb6ff",
                    "category": "system",
                    "purpose": "把五項能力轉成每日任務與可保存的產出。",
                    "featuredRank": 1,
                    "liveUrl": "https://xieyaozhong.github.io/BOSS/"
                }
            }
        }

    def test_build_catalog_filters_and_orders_owned_public_repositories(self) -> None:
        repositories = [
            repository(2, "recent-tool", updated_at="2026-09-02T02:00:00Z", description="最近更新的工具"),
            repository(1, "BOSS", updated_at="2026-09-01T00:00:00Z"),
            repository(3, "older-tool", updated_at="2026-08-01T00:00:00Z", description="較早更新的工具"),
            repository(4, "forked", updated_at="2026-09-03T00:00:00Z", fork=True),
            repository(5, "private", updated_at="2026-09-03T00:00:00Z", private=True),
            repository(6, "not-owned", updated_at="2026-09-03T00:00:00Z", owner="somebody-else")
        ]
        catalog = build_catalog(repositories, self.config, "2026-09-02T00:00:00Z")

        self.assertEqual([project["slug"] for project in catalog["projects"]], ["BOSS", "recent-tool", "older-tool"])
        self.assertEqual(catalog["total"], 3)
        self.assertEqual(catalog["featuredCount"], 1)
        self.assertEqual(catalog["projects"][0]["purpose"], "把五項能力轉成每日任務與可保存的產出。")
        self.assertEqual(catalog["projects"][0]["icon"], "BO")

    def test_fallback_uses_description_then_neutral_copy(self) -> None:
        repositories = [
            repository(1, "described", updated_at="2026-09-02T00:00:00Z", description="一個清楚的公開工具"),
            repository(2, "undocumented", updated_at="2026-09-01T00:00:00Z", description=None, language="Python")
        ]
        catalog = build_catalog(repositories, self.config, "2026-09-02T00:00:00Z")
        by_slug = {project["slug"]: project for project in catalog["projects"]}

        self.assertEqual(by_slug["described"]["purpose"], "一個清楚的公開工具")
        self.assertEqual(by_slug["undocumented"]["purpose"], "以 Python 製作的公開作品，詳細用途待補充。")
        self.assertEqual(by_slug["described"]["category"], "other")
        self.assertEqual(fallback_icon("sample-project"), "SA")

    def test_only_https_homepages_are_published(self) -> None:
        repositories = [
            repository(1, "secure", updated_at="2026-09-02T00:00:00Z", homepage="https://example.com/demo"),
            repository(2, "insecure", updated_at="2026-09-01T00:00:00Z", homepage="http://example.com/demo")
        ]
        catalog = build_catalog(repositories, self.config, "2026-09-02T00:00:00Z")
        by_slug = {project["slug"]: project for project in catalog["projects"]}
        self.assertEqual(by_slug["secure"]["liveUrl"], "https://example.com/demo")
        self.assertIsNone(by_slug["insecure"]["liveUrl"])

    def test_long_github_description_is_safely_truncated(self) -> None:
        catalog = build_catalog([
            repository(1, "long-copy", updated_at="2026-09-02T00:00:00Z", description="說" * 300)
        ], self.config, "2026-09-02T00:00:00Z")
        purpose = catalog["projects"][0]["purpose"]
        self.assertEqual(len(purpose), 180)
        self.assertTrue(purpose.endswith("…"))

    def test_fallback_icons_remain_unique(self) -> None:
        catalog = build_catalog([
            repository(1, "sample", updated_at="2026-09-02T00:00:00Z"),
            repository(2, "same", updated_at="2026-09-01T00:00:00Z")
        ], self.config, "2026-09-02T00:00:00Z")
        icons = [project["icon"] for project in catalog["projects"]]
        self.assertEqual(len(icons), len(set(icons)))
        self.assertTrue(all(1 <= len(icon) <= 3 for icon in icons))

    def test_uncurated_repositories_can_be_quarantined(self) -> None:
        config = json.loads(json.dumps(self.config))
        config["publishUncurated"] = False
        catalog = build_catalog([
            repository(1, "BOSS", updated_at="2026-09-02T00:00:00Z"),
            repository(2, "new-unreviewed", updated_at="2026-09-02T01:00:00Z")
        ], config, "2026-09-02T00:00:00Z")
        self.assertEqual([project["slug"] for project in catalog["projects"]], ["BOSS"])
        self.assertEqual(catalog["pendingCount"], 1)

    def test_catalog_age_is_measured_in_utc(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog.json"
            path.write_text(json.dumps({"generatedAt": "2026-09-02T00:00:00Z"}), encoding="utf-8")
            age = catalog_age_hours(path, datetime.fromisoformat("2026-09-02T12:00:00+00:00"))
            self.assertEqual(age, 12.0)

    def test_real_override_config_is_valid(self) -> None:
        config = load_config(Path(__file__).resolve().parents[1] / "config" / "project-overrides.json")
        self.assertEqual(config["owner"], "xieyaozhong")
        self.assertGreaterEqual(len(config["projects"]), 30)
        self.assertEqual(len(config["projects"]), len(set(config["projects"])))

    def test_load_config_rejects_invalid_accent(self) -> None:
        broken = json.loads(json.dumps(self.config))
        broken["projects"]["BOSS"]["accent"] = "blue"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "invalid accent"):
                load_config(path)

    def test_load_config_rejects_duplicate_icons(self) -> None:
        broken = json.loads(json.dumps(self.config))
        broken["projects"]["another"] = {
            "title": "Another",
            "icon": "BO",
            "accent": "#7ccdb4",
            "category": "other",
            "purpose": "另一個具有完整用途說明的公開作品。"
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            path.write_text(json.dumps(broken), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate project icon"):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
