from __future__ import annotations

from dataclasses import dataclass, replace
from random import Random

from .models import Clue, Level, Rectangle
from .scoring import Evaluation, evaluate_level


@dataclass(frozen=True, slots=True)
class GeneratorConfig:
    width: int = 7
    height: int = 7
    min_area: int = 2
    max_area: int = 12
    min_regions: int = 6
    max_regions: int = 14
    shape_clue_probability: float = 0.38
    min_interest: float = 50.0
    max_level_attempts: int = 800
    clue_variants_per_tiling: int = 18
    tiling_search_limit: int = 30_000

    def validate(self) -> None:
        if self.width < 1 or self.height < 1:
            raise ValueError("Board dimensions must be positive")
        if not 1 <= self.min_area <= self.max_area:
            raise ValueError("Area bounds are invalid")
        if self.max_area > self.width * self.height:
            raise ValueError("max_area cannot exceed board area")
        if not 0.0 <= self.shape_clue_probability <= 1.0:
            raise ValueError("shape_clue_probability must be between 0 and 1")
        if not 1 <= self.min_regions <= self.max_regions:
            raise ValueError("Region bounds are invalid")


class LevelGenerator:
    def __init__(self, config: GeneratorConfig | None = None) -> None:
        self.config = config or GeneratorConfig()
        self.config.validate()

    def _rectangle_options(self, x: int, y: int, owners: list[int]) -> list[Rectangle]:
        config = self.config
        options: list[Rectangle] = []
        for height in range(1, config.height - y + 1):
            for width in range(1, config.width - x + 1):
                area = width * height
                if area < config.min_area or area > config.max_area:
                    continue
                rectangle = Rectangle(x, y, width, height)
                if all(owners[cell] < 0 for cell in rectangle.cells(config.width)):
                    options.append(rectangle)
        return options

    def _random_tiling(self, rng: Random) -> tuple[Rectangle, ...] | None:
        config = self.config
        cell_count = config.width * config.height
        owners = [-1] * cell_count
        regions: list[Rectangle] = []
        visited = 0

        def search(filled: int) -> bool:
            nonlocal visited
            visited += 1
            if visited > config.tiling_search_limit:
                return False
            remaining = cell_count - filled
            if remaining == 0:
                return config.min_regions <= len(regions) <= config.max_regions
            if remaining < config.min_area:
                return False
            minimum_more = (remaining + config.max_area - 1) // config.max_area
            maximum_more = remaining // config.min_area
            if len(regions) + minimum_more > config.max_regions:
                return False
            if len(regions) + maximum_more < config.min_regions:
                return False

            first = owners.index(-1)
            x, y = first % config.width, first // config.width
            options = self._rectangle_options(x, y, owners)
            rng.shuffle(options)
            # Prefer medium-sized, non-strip regions while retaining randomness.
            options.sort(
                key=lambda rect: (
                    abs(rect.area - rng.choice((4, 6, 8))),
                    1 if min(rect.width, rect.height) == 1 else 0,
                    rng.random(),
                )
            )
            for rectangle in options:
                cells = rectangle.cells(config.width)
                region_id = len(regions)
                for cell in cells:
                    owners[cell] = region_id
                regions.append(rectangle)
                if search(filled + rectangle.area):
                    return True
                regions.pop()
                for cell in cells:
                    owners[cell] = -1
            return False

        return tuple(regions) if search(0) else None

    def _make_clues(
        self,
        regions: tuple[Rectangle, ...],
        rng: Random,
        shape_clue_probability: float,
    ) -> tuple[Clue, ...]:
        clues: list[Clue] = []
        for region in regions:
            x = rng.randrange(region.x, region.x + region.width)
            y = rng.randrange(region.y, region.y + region.height)
            reveal_shape = rng.random() < shape_clue_probability
            clues.append(Clue(x=x, y=y, area=region.area, shape=region.shape if reveal_shape else None))
        return tuple(clues)

    def generate(self, seed: int | None = None, difficulty: str | None = None) -> Level:
        """Generate one unique, interesting level.

        ``difficulty`` may be tutorial, easy, medium, hard or expert. Generation is
        deterministic when a seed is supplied.
        """
        allowed_difficulties = {"tutorial", "easy", "medium", "hard", "expert"}
        if difficulty is not None and difficulty not in allowed_difficulties:
            raise ValueError(f"Unknown difficulty: {difficulty}")
        actual_seed = seed if seed is not None else Random().randrange(0, 2**63)
        rng = Random(actual_seed)
        best: tuple[Level, Evaluation] | None = None
        target_shape_probability = {
            "tutorial": 0.82,
            "easy": 0.62,
            "medium": 0.38,
            "hard": 0.16,
            "expert": 0.03,
        }.get(difficulty, self.config.shape_clue_probability)

        for _ in range(self.config.max_level_attempts):
            regions = self._random_tiling(rng)
            if regions is None:
                continue
            for _ in range(self.config.clue_variants_per_tiling):
                clues = self._make_clues(regions, rng, target_shape_probability)
                draft = Level(
                    width=self.config.width,
                    height=self.config.height,
                    clues=clues,
                    solution=regions,
                    seed=actual_seed,
                )
                evaluation = evaluate_level(draft, min_interest=self.config.min_interest)
                if best is None or evaluation.interest_score > best[1].interest_score:
                    best = (draft, evaluation)
                difficulty_matches = difficulty is None or evaluation.difficulty == difficulty
                if evaluation.accepted and difficulty_matches:
                    return replace(
                        draft,
                        interest_score=evaluation.interest_score,
                        difficulty_score=evaluation.difficulty_score,
                        difficulty=evaluation.difficulty,
                        evaluation=evaluation.to_dict(),
                    )

        detail = ""
        if best is not None:
            detail = (
                f" Best candidate: interest={best[1].interest_score}, "
                f"difficulty={best[1].difficulty}, solutions={best[1].solve_result.solution_count}."
            )
        raise RuntimeError(
            "Could not generate a level within the configured attempt limit."
            + detail
            + " Try a lower min_interest or do not constrain difficulty."
        )

    def generate_many(
        self,
        count: int,
        seed: int | None = None,
        difficulty: str | None = None,
    ) -> tuple[Level, ...]:
        if count < 1:
            raise ValueError("count must be positive")
        master_seed = seed if seed is not None else Random().randrange(0, 2**63)
        rng = Random(master_seed)
        return tuple(
            self.generate(seed=rng.randrange(0, 2**63), difficulty=difficulty)
            for _ in range(count)
        )
