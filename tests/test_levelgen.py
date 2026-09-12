from __future__ import annotations

import json
import unittest
from pathlib import Path

from levelgen import Clue, GeneratorConfig, Level, LevelGenerator, Shape, evaluate_level, solve_level


class LevelGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.generator = LevelGenerator(
            GeneratorConfig(
                min_interest=42,
                max_level_attempts=300,
                clue_variants_per_tiling=12,
            )
        )
        cls.level = cls.generator.generate(seed=20260912)

    def test_generated_level_is_a_valid_partition(self) -> None:
        level = self.level
        covered: set[tuple[int, int]] = set()
        self.assertEqual(len(level.clues), len(level.solution))
        for clue, region in zip(level.clues, level.solution):
            self.assertGreaterEqual(region.area, 2)
            self.assertLessEqual(region.area, 12)
            self.assertEqual(clue.area, region.area)
            self.assertTrue(region.contains(clue.x, clue.y))
            if clue.shape is not None:
                self.assertEqual(clue.shape, region.shape)
            for cell in region.cells(level.width):
                coordinate = (cell % level.width, cell // level.width)
                self.assertNotIn(coordinate, covered)
                covered.add(coordinate)
        self.assertEqual(len(covered), level.width * level.height)

    def test_generated_level_has_one_solution(self) -> None:
        self.assertTrue(solve_level(self.level).is_unique)

    def test_generation_is_deterministic(self) -> None:
        second = self.generator.generate(seed=20260912)
        self.assertEqual(self.level.to_dict(), second.to_dict())

    def test_shape_classification(self) -> None:
        shapes = {region.shape for region in self.level.solution}
        self.assertTrue(shapes <= {Shape.SQUARE, Shape.HORIZONTAL, Shape.VERTICAL})

    def test_export_without_solution_can_be_analyzed(self) -> None:
        raw = self.level.to_dict(include_solution=False)
        imported = Level.from_dict(raw)
        evaluation = evaluate_level(imported, min_interest=42)
        self.assertTrue(evaluation.accepted)
        self.assertEqual(evaluation.difficulty, self.level.difficulty)

    def test_bundled_examples_are_unique_and_correctly_labeled(self) -> None:
        examples = Path(__file__).parents[1] / "examples"
        for path in examples.glob("*.json"):
            expected_difficulty = path.stem
            payload = json.loads(path.read_text(encoding="utf-8"))
            for raw in payload["levels"]:
                level = Level.from_dict(raw)
                evaluation = evaluate_level(level)
                self.assertTrue(evaluation.accepted, path.name)
                self.assertEqual(evaluation.difficulty, expected_difficulty, path.name)

    def test_solver_detects_ambiguous_partition(self) -> None:
        ambiguous = Level(
            width=2,
            height=2,
            clues=(Clue(0, 0, 2), Clue(1, 1, 2)),
        )
        self.assertEqual(solve_level(ambiguous).solution_count, 2)


if __name__ == "__main__":
    unittest.main()
