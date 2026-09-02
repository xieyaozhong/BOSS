from __future__ import annotations

import copy
import unittest

from scripts.validate_site import validate_certificates


def valid_catalog() -> dict:
    return {
        "schemaVersion": 1,
        "updatedAt": "2026-09-02T00:00:00+08:00",
        "total": 1,
        "certifications": [
            {
                "id": "sample-certificate",
                "name": "測試用能力認證",
                "issuer": "測試發證單位",
                "issuedOn": "2026-06",
                "expiresOn": None,
                "doesNotExpire": False,
                "summary": "證明持有人完成指定能力範圍的正式評量。",
                "skillIds": ["code"],
                "verificationUrl": "https://credentials.example.org/verify/sample",
                "source": "user-confirmed",
                "confirmedOn": "2026-09-01",
            }
        ],
    }


class CertificateValidationTests(unittest.TestCase):
    def test_empty_catalog_is_valid(self) -> None:
        catalog = valid_catalog()
        catalog["total"] = 0
        catalog["certifications"] = []
        validate_certificates(catalog)

    def test_user_confirmed_record_is_valid(self) -> None:
        validate_certificates(valid_catalog())

    def test_rejects_private_or_unknown_fields(self) -> None:
        catalog = valid_catalog()
        catalog["certifications"][0]["credentialId"] = "hidden"
        with self.assertRaises(ValueError):
            validate_certificates(catalog)

    def test_rejects_unconfirmed_source(self) -> None:
        catalog = valid_catalog()
        catalog["certifications"][0]["source"] = "ai-inferred"
        with self.assertRaises(ValueError):
            validate_certificates(catalog)

    def test_rejects_unsafe_verification_urls(self) -> None:
        for url in (
            "http://credentials.example.org/verify/sample",
            "https://credentials.example.org/verify/sample?credential=1234",
            "https://credentials.example.org/verify/12345678",
        ):
            with self.subTest(url=url):
                catalog = valid_catalog()
                catalog["certifications"][0]["verificationUrl"] = url
                with self.assertRaises(ValueError):
                    validate_certificates(catalog)

    def test_rejects_expiry_before_issue(self) -> None:
        catalog = valid_catalog()
        catalog["certifications"][0]["expiresOn"] = "2026-05"
        with self.assertRaises(ValueError):
            validate_certificates(catalog)

    def test_rejects_duplicate_records(self) -> None:
        catalog = valid_catalog()
        duplicate = copy.deepcopy(catalog["certifications"][0])
        duplicate["id"] = "same-certificate"
        catalog["certifications"].append(duplicate)
        catalog["total"] = 2
        with self.assertRaises(ValueError):
            validate_certificates(catalog)

    def test_rejects_confirmation_after_catalog_update(self) -> None:
        catalog = valid_catalog()
        catalog["certifications"][0]["confirmedOn"] = "2026-09-03"
        with self.assertRaises(ValueError):
            validate_certificates(catalog)


if __name__ == "__main__":
    unittest.main()
