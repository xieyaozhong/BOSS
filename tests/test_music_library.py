from __future__ import annotations

import copy
import unittest
from pathlib import Path

from scripts.validate_site import validate_music_library


def empty_catalog() -> dict:
    instruments = []
    for instrument_id, name, english_name in (
        ("violin", "小提琴", "VIOLIN"),
        ("guitar", "吉他", "GUITAR"),
        ("piano", "鋼琴", "PIANO"),
    ):
        instruments.append({
            "id": instrument_id,
            "name": name,
            "englishName": english_name,
            "tagline": "這是一段本人確認、可公開顯示的樂器資料說明。",
            "source": "user-confirmed",
            "sections": {"scores": [], "theory": [], "works": []},
        })
    return {
        "schemaVersion": 1,
        "updatedAt": "2026-09-02T12:00:00+08:00",
        "instrumentCount": 3,
        "itemCount": 0,
        "instruments": instruments,
    }


def music_item(item_id: str = "first-item") -> dict:
    return {
        "id": item_id,
        "title": "本人整理的音樂內容",
        "summary": "這是本人確認、可以公開顯示的音樂內容摘要。",
        "url": "https://media.example.org/my-work",
        "source": "user-confirmed",
        "rights": {
            "basis": "creator-owned",
            "license": None,
            "sourceUrl": None,
            "attribution": None,
        },
    }


def catalog_with_item(item: dict, section: str = "scores") -> dict:
    catalog = empty_catalog()
    catalog["instruments"][0]["sections"][section].append(item)
    catalog["itemCount"] = 1
    return catalog


class MusicLibraryValidationTests(unittest.TestCase):
    def test_three_instruments_and_nine_empty_sections_are_valid(self) -> None:
        validate_music_library(empty_catalog())

    def test_rejects_boolean_schema_version(self) -> None:
        catalog = empty_catalog()
        catalog["schemaVersion"] = True
        with self.assertRaises(ValueError):
            validate_music_library(catalog)

    def test_requires_exactly_the_confirmed_three_instruments(self) -> None:
        catalog = empty_catalog()
        catalog["instruments"].pop()
        catalog["instrumentCount"] = 2
        with self.assertRaises(ValueError):
            validate_music_library(catalog)

    def test_rejects_missing_sections_and_unknown_fields(self) -> None:
        for mutation in ("missing-section", "unknown-field"):
            with self.subTest(mutation=mutation):
                catalog = empty_catalog()
                if mutation == "missing-section":
                    del catalog["instruments"][0]["sections"]["works"]
                else:
                    catalog["instruments"][0]["level"] = "advanced"
                with self.assertRaises(ValueError):
                    validate_music_library(catalog)

    def test_rejects_unconfirmed_or_duplicate_items(self) -> None:
        catalog = catalog_with_item(music_item())
        duplicate = copy.deepcopy(catalog["instruments"][0]["sections"]["scores"][0])
        catalog["instruments"][1]["sections"]["works"].append(duplicate)
        catalog["itemCount"] = 2
        with self.assertRaises(ValueError):
            validate_music_library(catalog)

    def test_rejects_embedded_protected_content_fields(self) -> None:
        for field in ("lyrics", "fullText", "scan", "downloadMirror"):
            with self.subTest(field=field):
                item = music_item()
                item[field] = "不應被收進公開資料的完整內容"
                with self.assertRaises(ValueError):
                    validate_music_library(catalog_with_item(item))

        catalog = catalog_with_item(music_item())
        catalog["instruments"][0]["sections"]["scores"][0]["source"] = "ai-inferred"
        with self.assertRaises(ValueError):
            validate_music_library(catalog)

    def test_rejects_unsafe_urls_and_local_paths(self) -> None:
        for url in (
            "http://media.example.org/work",
            "https://user:secret@media.example.org/work",
            "https://media.example.org/work?auth=secret",
            "https://media.example.org/work#private",
            "./assets/music/../private.pdf",
            "./assets/music/missing.pdf",
        ):
            with self.subTest(url=url):
                item = music_item()
                item["url"] = url
                with self.assertRaises(ValueError):
                    validate_music_library(catalog_with_item(item))

    def test_frontend_exposes_source_and_license_links(self) -> None:
        app = (Path(__file__).resolve().parents[1] / "site" / "assets" / "app.js").read_text(encoding="utf-8")
        self.assertIn("MUSIC_LICENSE_URLS[item.rights.license]", app)
        self.assertIn("item.rights.sourceUrl && item.rights.sourceUrl !== item.url", app)

    def test_accepts_each_supported_rights_basis(self) -> None:
        cases = {
            "creator-owned": {
                "basis": "creator-owned", "license": None, "sourceUrl": None, "attribution": None,
            },
            "explicit-license": {
                "basis": "explicit-license", "license": "CC-BY-4.0",
                "sourceUrl": "https://scores.example.org/licensed", "attribution": "Composer · CC BY 4.0",
            },
            "public-domain-edition": {
                "basis": "public-domain-edition", "license": "Public Domain",
                "sourceUrl": "https://archive.example.org/edition", "attribution": "Verified public-domain edition",
            },
            "external-link-only": {
                "basis": "external-link-only", "license": None,
                "sourceUrl": "https://publisher.example.org/score", "attribution": "Publisher source",
            },
        }
        for basis, rights in cases.items():
            with self.subTest(basis=basis):
                item = music_item(basis)
                item["rights"] = rights
                if basis == "external-link-only":
                    item["url"] = rights["sourceUrl"]
                validate_music_library(catalog_with_item(item))

    def test_rejects_incomplete_or_unknown_rights(self) -> None:
        for rights in (
            {"basis": "unknown", "license": None, "sourceUrl": None, "attribution": None},
            {"basis": "explicit-license", "license": None, "sourceUrl": "https://scores.example.org/source", "attribution": "Source"},
            {"basis": "public-domain-edition", "license": "Public Domain", "sourceUrl": None, "attribution": "Old composition only"},
        ):
            with self.subTest(rights=rights["basis"]):
                item = music_item()
                item["rights"] = rights
                with self.assertRaises(ValueError):
                    validate_music_library(catalog_with_item(item))


if __name__ == "__main__":
    unittest.main()
