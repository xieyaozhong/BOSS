#!/usr/bin/env python3
"""Generate a deterministic, time-boxed daily capability plan."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


TAIPEI = ZoneInfo("Asia/Taipei")
SKILL_IDS = ("music", "art", "code", "language", "network")


def stable_int(value: str) -> int:
    return int(hashlib.sha256(value.encode("utf-8")).hexdigest()[:12], 16)


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == rendered:
        return
    path.write_text(rendered, encoding="utf-8")


def validate_output(output: dict[str, Any], context: str) -> None:
    for field in ("title", "brief", "doneWhen"):
        if not isinstance(output.get(field), str) or not output[field].strip():
            raise ValueError(f"{context}.{field} must be a non-empty string")
    difficulty = int(output.get("difficulty", 0))
    minimum = int(output.get("minMinutes", 0))
    direction_index = int(output.get("directionIndex", -1))
    if not 1 <= difficulty <= 5:
        raise ValueError(f"{context}.difficulty must be between 1 and 5")
    if not 10 <= minimum <= 90:
        raise ValueError(f"{context}.minMinutes must be between 10 and 90")
    if direction_index < 0:
        raise ValueError(f"{context}.directionIndex must be non-negative")


def validate_profile(profile: dict[str, Any]) -> None:
    settings = profile.get("profile", {})
    daily_minutes = int(settings.get("dailyMinutes", 0))
    weekly_target = int(settings.get("weeklyOutputTarget", 0))
    if daily_minutes not in {30, 45, 60, 90}:
        raise ValueError("dailyMinutes must be one of 30, 45, 60, or 90")
    if weekly_target not in {3, 5, 7}:
        raise ValueError("weeklyOutputTarget must be one of 3, 5, or 7")

    skills = profile.get("skills")
    if not isinstance(skills, list) or len(skills) != len(SKILL_IDS):
        raise ValueError("profile must contain exactly five skills")
    ids = [skill.get("id") for skill in skills]
    if len(set(ids)) != len(SKILL_IDS) or set(ids) != set(SKILL_IDS):
        raise ValueError(f"profile skills must be unique and exactly {list(SKILL_IDS)}")

    skills_by_id = {skill["id"]: skill for skill in skills}
    for skill_id, skill in skills_by_id.items():
        for field in ("name", "englishName", "currentGoal", "nextMilestone"):
            if not isinstance(skill.get(field), str) or not skill[field].strip():
                raise ValueError(f"{skill_id}.{field} must be a non-empty string")
        if not isinstance(skill.get("color"), str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", skill["color"]):
            raise ValueError(f"{skill_id}.color must be a six-digit hex color")
        current = int(skill.get("currentLevel", 0))
        target = int(skill.get("targetLevel", 0))
        priority = int(skill.get("priority", 0))
        if not 1 <= current <= 5 or not 1 <= target <= 5 or not 1 <= priority <= 5:
            raise ValueError(f"{skill_id} levels and priority must be between 1 and 5")
        if not isinstance(skill.get("calibrated"), bool):
            raise ValueError(f"{skill_id}.calibrated must be a boolean")
        directions = skill.get("directions")
        if not isinstance(directions, list) or not directions or not all(isinstance(item, str) and item.strip() for item in directions):
            raise ValueError(f"{skill_id}.directions must contain text")
        strengths = skill.get("strengths")
        if not isinstance(strengths, list) or not all(isinstance(item, str) for item in strengths):
            raise ValueError(f"{skill_id}.strengths must be a string array")
        practices = skill.get("practicePool")
        if not isinstance(practices, list) or not practices:
            raise ValueError(f"{skill_id}.practicePool is required")
        for index, practice in enumerate(practices):
            if not all(isinstance(practice.get(field), str) and practice[field].strip() for field in ("title", "detail")):
                raise ValueError(f"{skill_id}.practicePool[{index}] is incomplete")
        outputs = skill.get("outputPool")
        if not isinstance(outputs, list) or not outputs:
            raise ValueError(f"{skill_id}.outputPool is required")
        for index, output in enumerate(outputs):
            validate_output(output, f"{skill_id}.outputPool[{index}]")
            if int(output["directionIndex"]) >= len(directions):
                raise ValueError(f"{skill_id}.outputPool[{index}].directionIndex is out of range")
        minimum_focus = daily_minutes - min(10, max(6, round(daily_minutes * 0.18))) - (0 if skill_id == "network" else 5)
        if not any(int(output["minMinutes"]) <= minimum_focus for output in outputs):
            raise ValueError(f"{skill_id} has no output that fits the configured daily time budget")

    recommendation = profile.get("recommendation", {})
    if int(recommendation.get("maxDailyItems", 0)) != 3:
        raise ValueError("maxDailyItems must be 3 for this interface")
    max_cross = int(recommendation.get("maxCrossSkillPerWeek", -1))
    if not 0 <= max_cross <= 2:
        raise ValueError("maxCrossSkillPerWeek must be between 0 and 2")
    if not isinstance(recommendation.get("allowCrossSkill"), bool):
        raise ValueError("allowCrossSkill must be a boolean")

    cross_outputs = profile.get("crossSkillOutputs")
    if not isinstance(cross_outputs, list):
        raise ValueError("crossSkillOutputs must be an array")
    for index, output in enumerate(cross_outputs):
        validate_output(output, f"crossSkillOutputs[{index}]")
        primary = output.get("primary")
        secondary = output.get("secondary")
        if primary not in skills_by_id or secondary not in skills_by_id or primary == secondary:
            raise ValueError(f"crossSkillOutputs[{index}] has invalid skill references")
        if int(output["directionIndex"]) >= len(skills_by_id[primary]["directions"]):
            raise ValueError(f"crossSkillOutputs[{index}].directionIndex is out of range")

    network_actions = profile.get("networkActions")
    if not isinstance(network_actions, list) or not network_actions:
        raise ValueError("networkActions must contain at least one action")
    for index, action in enumerate(network_actions):
        if not all(isinstance(action.get(field), str) and action[field].strip() for field in ("title", "detail")):
            raise ValueError(f"networkActions[{index}] is incomplete")


def score_skills(profile: dict[str, Any], target_day: date) -> list[dict[str, Any]]:
    """Score public baseline data without pretending to know private history."""
    scored: list[dict[str, Any]] = []
    skills = profile["skills"]
    rotation_slot = target_day.toordinal() % len(skills)
    for index, skill in enumerate(skills):
        calibrated = bool(skill.get("calibrated", False))
        gap = max(0, int(skill["targetLevel"]) - int(skill["currentLevel"])) / 4 if calibrated else 0.5
        priority = int(skill["priority"]) / 5 if calibrated else 0.6
        distance = (index - rotation_slot) % len(skills)
        rotation = 1.0 if distance == 0 else (0.30 if distance == 1 else 0.0)
        score = gap * 0.30 + priority * 0.20 + rotation * 0.50
        scored.append({"skill": skill, "score": round(score, 5)})
    return sorted(scored, key=lambda item: (-item["score"], item["skill"]["id"]))


def choose_fitting_output(candidates: list[dict[str, Any]], focus_minutes: int, desired: int, salt: str) -> dict[str, Any]:
    fitting = [item for item in candidates if int(item["minMinutes"]) <= focus_minutes]
    if not fitting:
        raise ValueError(f"no output fits a {focus_minutes}-minute focus budget")
    pool = fitting
    closest_distance = min(abs(int(item["difficulty"]) - desired) for item in pool)
    closest = [item for item in pool if abs(int(item["difficulty"]) - desired) == closest_distance]
    return closest[stable_int(salt) % len(closest)]


def split_minutes(total: int) -> list[int]:
    scope = max(4, round(total * 0.20))
    finish = max(5, round(total * 0.25))
    return [scope, total - scope - finish, finish]


def generate(profile: dict[str, Any], target_day: date) -> dict[str, Any]:
    validate_profile(profile)
    ranking = score_skills(profile, target_day)
    primary = ranking[0]["skill"]
    skills_by_id = {skill["id"]: skill for skill in profile["skills"]}
    daily_minutes = int(profile["profile"]["dailyMinutes"])
    maintain_minutes = min(10, max(6, round(daily_minutes * 0.18)))
    desired = round((int(primary["currentLevel"]) + int(primary["targetLevel"])) / 2) if primary.get("calibrated") else 2

    max_cross = int(profile["recommendation"]["maxCrossSkillPerWeek"])
    allowed_cross_weekdays = (1, 4)[:max_cross]
    cross_candidates = []
    for output in profile["crossSkillOutputs"]:
        if output["primary"] != primary["id"]:
            continue
        network_minutes_for_output = 0 if output["secondary"] == "network" else 5
        available = daily_minutes - maintain_minutes - network_minutes_for_output
        if int(output["minMinutes"]) <= available:
            cross_candidates.append(output)

    use_cross = bool(
        profile["recommendation"].get("allowCrossSkill", True)
        and primary["id"] != "network"
        and target_day.weekday() in allowed_cross_weekdays
        and cross_candidates
    )

    if use_cross:
        output = choose_fitting_output(
            cross_candidates,
            daily_minutes - maintain_minutes,
            desired,
            f"{target_day}:cross:{primary['id']}"
        )
        secondary = skills_by_id[output["secondary"]]
    else:
        secondary = None
        provisional_network_minutes = 0 if primary["id"] == "network" else 5
        output = choose_fitting_output(
            primary["outputPool"],
            daily_minutes - maintain_minutes - provisional_network_minutes,
            desired,
            f"{target_day}:{primary['id']}:output"
        )

    excluded = {primary["id"], secondary["id"] if secondary else None}
    maintain = next(
        item["skill"] for item in ranking
        if item["skill"]["id"] not in excluded
        and (primary["id"] == "network" or item["skill"]["id"] != "network")
    )
    maintain_practice = maintain["practicePool"][stable_int(f"{target_day}:{maintain['id']}:maintain") % len(maintain["practicePool"])]
    network_action = profile["networkActions"][stable_int(f"{target_day}:network") % len(profile["networkActions"])]
    network_minutes = 0 if primary["id"] == "network" or (secondary and secondary["id"] == "network") else 5
    focus_minutes = daily_minutes - maintain_minutes - network_minutes
    minutes = split_minutes(focus_minutes)
    direction = primary["directions"][int(output["directionIndex"])]
    low_confidence = not bool(primary.get("calibrated", False))
    strengths = primary.get("strengths", [])

    if low_confidence:
        why = f"先用一個難度 {output['difficulty']}/5、可完成的{primary['name']}產出建立基準；校準程度後再依紀錄調整。"
    else:
        strength_lead = f"以你已會的「{'、'.join(strengths[:2])}」為起點，" if strengths else ""
        why = f"{strength_lead}今天聚焦「{direction}」，並朝「{primary['currentGoal']}」留下一個難度 {output['difficulty']}/5 的證據。"

    tags = [primary["name"]]
    if secondary:
        tags.append(secondary["name"])
    tags.append(f"精進｜{direction}")

    return {
        "schemaVersion": 1,
        "date": target_day.isoformat(),
        "effectiveAt": f"{target_day.isoformat()}T06:17:00+08:00",
        "timezone": "Asia/Taipei",
        "engine": "rules-v2",
        "confidence": "calibration-needed" if low_confidence else "profile-based",
        "dailyBudgetMinutes": daily_minutes,
        "focus": {
            "skillId": primary["id"],
            "secondarySkillId": secondary["id"] if secondary else None,
            "tags": tags,
            "direction": direction,
            "difficulty": int(output["difficulty"]),
            "minMinutes": int(output["minMinutes"]),
            "title": output["title"],
            "why": why,
            "totalMinutes": focus_minutes,
            "steps": [
                {"minutes": minutes[0], "title": "界定範圍", "detail": "把完成條件放在眼前，只準備這次會用到的素材與工具。"},
                {"minutes": minutes[1], "title": "做出主體", "detail": output["brief"]},
                {"minutes": minutes[2], "title": "收尾與保存", "detail": "停止增加功能或細節；檢查完成條件，命名、匯出並留下一張證據。"}
            ],
            "deliverable": {"title": output["title"], "doneWhen": output["doneWhen"]}
        },
        "maintain": {
            "skillId": maintain["id"],
            "skillName": maintain["name"],
            "minutes": maintain_minutes,
            "title": maintain_practice["title"],
            "detail": maintain_practice["detail"]
        },
        "network": (
            {"minutes": 0, "title": "今天主線已包含人脈行動", "detail": "完成主線即可，不另外增加聯繫壓力。"}
            if network_minutes == 0
            else {"minutes": network_minutes, **network_action}
        ),
        "selection": {
            "ranking": [{"skillId": item["skill"]["id"], "score": item["score"]} for item in ranking],
            "signals": ["目標差距", "優先權", "五日輪替", "時間與難度適配", "明確完成條件"]
        }
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    project_root = Path(__file__).resolve().parents[1]
    parser.add_argument("--profile", type=Path, default=project_root / "site" / "data" / "profile.json")
    parser.add_argument("--output", type=Path, default=project_root / "site" / "data" / "today.json")
    parser.add_argument("--date", help="Generate for YYYY-MM-DD instead of today's Asia/Taipei date")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    target_day = date.fromisoformat(args.date) if args.date else datetime.now(TAIPEI).date()
    profile = load_json(args.profile)
    plan = generate(profile, target_day)
    write_json(args.output, plan)
    print(f"Generated {plan['focus']['title']} for {target_day.isoformat()} ({plan['engine']})")


if __name__ == "__main__":
    main()
