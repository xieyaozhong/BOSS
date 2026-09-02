from __future__ import annotations

import unittest

from scripts.validate_site import PUBLIC_SECRET_PATTERNS


class PublicSecretPatternTests(unittest.TestCase):
    def test_detects_fine_grained_github_token(self) -> None:
        sample = "github_pat_" + "A1_" * 20
        self.assertIsNotNone(PUBLIC_SECRET_PATTERNS["GitHub fine-grained token"].search(sample))

    def test_does_not_flag_placeholder(self) -> None:
        self.assertIsNone(PUBLIC_SECRET_PATTERNS["GitHub fine-grained token"].search("github_pat_your_token_here"))


if __name__ == "__main__":
    unittest.main()
