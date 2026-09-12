from __future__ import annotations

from dataclasses import dataclass
from math import log2
from typing import Any

from .models import Level
from .solver import SolveResult, solve_level


@dataclass(frozen=True, slots=True)
class Evaluation:
    accepted: bool
    interest_score: float
    difficulty_score: float
    difficulty: str
    reasons: tuple[str, ...]
    features: dict[str, float]
    solve_result: SolveResult

    def to_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "reasons": list(self.reasons),
            "features": {key: round(value, 3) for key, value in self.features.items()},
            "solver": self.solve_result.stats.to_dict(),
        }


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _difficulty_label(score: float) -> str:
    # Thresholds are calibrated for a 7×7 board. They intentionally leave all
    # five bands reachable instead of treating the score as a percentile.
    if score < 22:
        return "tutorial"
    if score < 34:
        return "easy"
    if score < 47:
        return "medium"
    if score < 60:
        return "hard"
    return "expert"


def evaluate_level(level: Level, min_interest: float = 50.0) -> Evaluation:
    solve_result = solve_level(level, max_solutions=2)
    reasons: list[str] = []
    region_count = len(level.clues)
    counts = solve_result.stats.initial_candidate_counts
    average_candidates = sum(counts) / len(counts) if counts else 0.0
    singleton_ratio = sum(count == 1 for count in counts) / len(counts) if counts else 1.0
    revealed_ratio = sum(clue.shape is not None for clue in level.clues) / region_count if region_count else 1.0
    area_values = {clue.area for clue in level.clues}
    # Quality must depend on the puzzle visible to the player, not on a possibly
    # stale solution bundled with imported JSON.
    scored_solution = solve_result.solutions[0] if solve_result.solutions else ()
    dimension_values = {(region.width, region.height) for region in scored_solution}
    shape_values = {region.shape for region in scored_solution}

    ambiguity = _clamp(average_candidates / 6.0)
    nontriviality = 1.0 - singleton_ratio
    area_diversity = _clamp(len(area_values) / min(6, max(1, region_count)))
    dimension_diversity = _clamp(len(dimension_values) / min(7, max(1, region_count)))
    shape_diversity = len(shape_values) / 3.0
    clue_mix = _clamp(1.0 - abs(revealed_ratio - 0.38) / 0.62)
    count_balance = _clamp(1.0 - abs(region_count - 9) / 7.0)

    features = {
        "ambiguity": ambiguity,
        "nontriviality": nontriviality,
        "areaDiversity": area_diversity,
        "dimensionDiversity": dimension_diversity,
        "shapeDiversity": shape_diversity,
        "clueMix": clue_mix,
        "regionCountBalance": count_balance,
    }
    interest_score = 100.0 * (
        0.20 * ambiguity
        + 0.20 * nontriviality
        + 0.16 * area_diversity
        + 0.14 * dimension_diversity
        + 0.10 * shape_diversity
        + 0.12 * clue_mix
        + 0.08 * count_balance
    )

    areas_follow_rules = all(2 <= clue.area <= 12 for clue in level.clues)
    if not areas_follow_rules:
        reasons.append("Площадь каждой области должна быть от 2 до 12")
        interest_score = 0.0
    if solve_result.solution_count == 0:
        reasons.append("У уровня нет решения")
        interest_score = 0.0
    elif solve_result.solution_count > 1:
        reasons.append("Уровень имеет несколько решений")
        interest_score *= 0.35
    if singleton_ratio > 0.55:
        reasons.append("Слишком много областей определяются сразу")
    if len(area_values) <= 2:
        reasons.append("Слишком мало разнообразия размеров")
    if len(shape_values) <= 1:
        reasons.append("Однообразная геометрия областей")
    if average_candidates > 12:
        reasons.append("Слишком много локальных вариантов, возможен перебор вместо логики")

    stats = solve_result.stats
    entropy_per_clue = (
        sum(log2(max(1, value)) for value in counts) / region_count if region_count else 0.0
    )
    entropy_factor = _clamp(entropy_per_clue / 3.0)
    search_factor = _clamp(log2(stats.search_nodes + 1) / 7.0)
    branch_factor = _clamp(stats.branch_points / max(1, region_count * 1.5))
    hidden_shape_factor = 1.0 - revealed_ratio
    difficulty_score = 100.0 * (
        0.34 * entropy_factor
        + 0.28 * search_factor
        + 0.22 * branch_factor
        + 0.16 * hidden_shape_factor
    )
    difficulty = _difficulty_label(difficulty_score)
    accepted = areas_follow_rules and solve_result.is_unique and interest_score >= min_interest
    if solve_result.is_unique and interest_score < min_interest:
        reasons.append(f"Интересность ниже порога {min_interest:g}")

    return Evaluation(
        accepted=accepted,
        interest_score=round(interest_score, 2),
        difficulty_score=round(difficulty_score, 2),
        difficulty=difficulty,
        reasons=tuple(reasons),
        features=features,
        solve_result=solve_result,
    )
