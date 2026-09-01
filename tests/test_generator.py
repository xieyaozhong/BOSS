from __future__ import annotations

import copy
import json
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from generate_daily import generate, validate_profile  # noqa: E402


class DailyGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.profile = json.loads((ROOT / "site" / "data" / "profile.json").read_text(encoding="utf-8"))

    def test_same_input_is_deterministic(self) -> None:
        target = date(2026, 9, 1)
        self.assertEqual(generate(copy.deepcopy(self.profile), target), generate(copy.deepcopy(self.profile), target))

    def test_all_budgets_fit_and_balance(self) -> None:
        start = date(2026, 1, 1)
        expected_skills = {"music", "art", "code", "language", "network"}
        for budget in (30, 45, 60, 90):
            profile = copy.deepcopy(self.profile)
            profile["profile"]["dailyMinutes"] = budget
            seen: set[str] = set()
            cross_dates: list[date] = []
            for offset in range(35):
                target = start + timedelta(days=offset)
                plan = generate(profile, target)
                focus = plan["focus"]
                seen.add(focus["skillId"])
                if focus["secondarySkillId"]:
                    cross_dates.append(target)
                self.assertEqual(sum(step["minutes"] for step in focus["steps"]), focus["totalMinutes"])
                self.assertEqual(
                    focus["totalMinutes"] + plan["maintain"]["minutes"] + plan["network"]["minutes"],
                    budget,
                )
                self.assertGreaterEqual(focus["totalMinutes"], focus["minMinutes"])
            self.assertEqual(seen, expected_skills)
            for target in cross_dates:
                rolling = [day for day in cross_dates if target <= day < target + timedelta(days=7)]
                self.assertLessEqual(len(rolling), profile["recommendation"]["maxCrossSkillPerWeek"])

    def test_profile_rejects_impossible_outputs(self) -> None:
        profile = copy.deepcopy(self.profile)
        profile["profile"]["dailyMinutes"] = 30
        for output in profile["skills"][0]["outputPool"]:
            output["minMinutes"] = 90
        with self.assertRaises(ValueError):
            validate_profile(profile)

    def test_profile_requires_real_booleans(self) -> None:
        profile = copy.deepcopy(self.profile)
        profile["skills"][0]["calibrated"] = "false"
        with self.assertRaises(ValueError):
            validate_profile(profile)


if __name__ == "__main__":
    unittest.main()
