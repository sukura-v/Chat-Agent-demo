"""Exercise Skill knowledge loader — simplified from the parent system.

The parent verifies SHA-256 content hashes against signed SKILL releases
(services/exercise_knowledge_service + services/training_skill_catalog).
The demo keeps the same file layout and the same tool-facing output text,
but trusts the bundled resources directly so no signing pipeline is needed.

Lookup accepts both a Skill ID ('tongue_click_01') and its Chinese display
name ('弹舌训练'), and '_shared' for cross-exercise pathology knowledge.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Mapping

BASE_DIR = Path(__file__).resolve().parent
SKILLS_ROOT = BASE_DIR / "resources" / "training_skills"
VALID_KNOWLEDGE_TYPES = {"standard", "metrics", "pathology"}


def _load_release_dirs() -> list[Path]:
    """One release directory per skill (latest version directory wins).

    Versioned skills follow ``{skill}/{version}/knowledge/*.md``; the special
    ``_shared`` skill keeps its knowledge directly under ``_shared/knowledge/``.
    """
    releases: dict[str, Path] = {}
    if not SKILLS_ROOT.is_dir():
        return []
    for skill_dir in sorted(SKILLS_ROOT.iterdir()):
        if not skill_dir.is_dir():
            continue
        versions = [v for v in skill_dir.iterdir() if v.is_dir() and (v / "knowledge").is_dir()]
        if versions:
            releases[skill_dir.name] = sorted(versions)[-1]
        elif (skill_dir / "knowledge").is_dir():
            releases[skill_dir.name] = skill_dir
    return list(releases.values())


def _skill_display_name(release_dir: Path, skill_id: str) -> str:
    protocol = release_dir / "protocol.json"
    if protocol.is_file():
        try:
            data = json.loads(protocol.read_text(encoding="utf-8"))
            name = data.get("display_name")
            if name:
                return str(name)
        except (ValueError, OSError):
            pass
    return skill_id


def _resolve_release(exercise_id: str) -> tuple[Path, str] | None:
    for release_dir in _load_release_dirs():
        skill_id = release_dir.parent.name
        if exercise_id in {skill_id, _skill_display_name(release_dir, skill_id)}:
            return release_dir, skill_id
    return None


def _summarise_protocol(protocol: Mapping, exercise_id: str) -> str:
    steps_summary: list[str] = []
    for idx, step in enumerate(protocol.get("steps", [])):
        rules_summary = ", ".join(
            f"{rule.get('metric', '?')} {rule.get('condition', '?')} {rule.get('threshold', '?')}"
            for rule in step.get("validation_rules", [])
        )
        steps_summary.append(
            f"  Step {idx + 1}. {step.get('title', '?')}: "
            f"{step.get('instruction_text', '')} [规则: {rules_summary}]"
        )
    return (
        f"**训练动作**: {protocol.get('display_name', exercise_id)}\n"
        f"**描述**: {protocol.get('description', '')}\n"
        f"**步骤数量**: {protocol.get('total_steps', '?')}\n"
        f"**训练流程**:\n" + "\n".join(steps_summary)
    )


def _read_knowledge_section(release_dir: Path, knowledge_type: str) -> str:
    knowledge_dir = release_dir / "knowledge"
    candidates = [
        knowledge_dir / f"{knowledge_type}.md",
        knowledge_dir / f"{knowledge_type}_common.md",
    ]
    for path in candidates:
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
    return ""


def list_available_skills() -> list[str]:
    return [d.parent.name for d in _load_release_dirs()]


def load_exercise_knowledge(
    exercise_id: str,
    knowledge_type: Iterable[str] | None = None,
    mode: str = "conversation",
) -> str:
    """Load the requested knowledge dimensions for one exercise."""
    requested = list(knowledge_type or ["all"])
    if "all" in requested:
        requested = ["standard", "metrics", "pathology"]
    requested = [t for t in dict.fromkeys(requested) if t in VALID_KNOWLEDGE_TYPES]

    resolved = _resolve_release(exercise_id)
    if resolved is None:
        available = ", ".join(list_available_skills()) or "none"
        return (
            f"[KNOWLEDGE_MISSING] 未在已发布 Skill 目录中找到「{exercise_id}」。"
            f"可用 Skill: {available}。"
        )

    release_dir, skill_id = resolved
    display_name = _skill_display_name(release_dir, skill_id)
    sections: list[str] = [f"【训练动作临床知识 · {display_name} ({skill_id})】"]

    protocol_path = release_dir / "protocol.json"
    if protocol_path.is_file():
        try:
            protocol = json.loads(protocol_path.read_text(encoding="utf-8"))
            sections.append(_summarise_protocol(protocol, skill_id))
        except (ValueError, OSError):
            pass

    for knowledge in requested:
        body = _read_knowledge_section(release_dir, knowledge)
        if body:
            sections.append(f"### {knowledge}\n{body}")

    if len(sections) <= 1:
        return f"[KNOWLEDGE_MISSING] Skill「{skill_id}」缺少可用的知识文件。"
    return "\n\n".join(sections)
