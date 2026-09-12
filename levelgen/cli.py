from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from .generator import GeneratorConfig, LevelGenerator
from .models import Level
from .scoring import evaluate_level


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Генератор уровней для головоломки 7×7")
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate = subparsers.add_parser("generate", help="сгенерировать набор уровней")
    generate.add_argument("--count", type=int, default=1)
    generate.add_argument("--seed", type=int)
    generate.add_argument("--output", type=Path, default=Path("levels.json"))
    generate.add_argument("--min-interest", type=float, default=50.0)
    generate.add_argument(
        "--difficulty",
        choices=("tutorial", "easy", "medium", "hard", "expert"),
    )
    generate.add_argument("--without-solution", action="store_true")

    analyze = subparsers.add_parser("analyze", help="проверить и оценить уровни из JSON")
    analyze.add_argument("input", type=Path)
    analyze.add_argument("--min-interest", type=float, default=50.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    if args.command == "generate":
        config = GeneratorConfig(min_interest=args.min_interest)
        generator = LevelGenerator(config)
        levels = generator.generate_many(args.count, seed=args.seed, difficulty=args.difficulty)
        payload = {
            "version": 1,
            "levels": [level.to_dict(include_solution=not args.without_solution) for level in levels],
        }
        _write_json(args.output, payload)
        print(f"Создано уровней: {len(levels)}")
        print(f"Файл: {args.output.resolve()}")
        for index, level in enumerate(levels, start=1):
            print(
                f"{index}: интересность {level.interest_score:.1f}, "
                f"сложность {level.difficulty} ({level.difficulty_score:.1f})"
            )
        return 0

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    raw_levels = payload.get("levels", [payload]) if isinstance(payload, dict) else payload
    output = []
    for index, raw_level in enumerate(raw_levels, start=1):
        level = Level.from_dict(raw_level)
        evaluation = evaluate_level(level, min_interest=args.min_interest)
        output.append(
            {
                "level": index,
                "solutions": evaluation.solve_result.solution_count,
                "accepted": evaluation.accepted,
                "interestScore": evaluation.interest_score,
                "difficulty": evaluation.difficulty,
                "difficultyScore": evaluation.difficulty_score,
                "reasons": list(evaluation.reasons),
            }
        )
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

