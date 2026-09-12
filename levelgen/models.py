from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class Shape(str, Enum):
    SQUARE = "square"
    HORIZONTAL = "horizontal"
    VERTICAL = "vertical"


@dataclass(frozen=True, slots=True)
class Rectangle:
    x: int
    y: int
    width: int
    height: int

    @property
    def area(self) -> int:
        return self.width * self.height

    @property
    def shape(self) -> Shape:
        if self.width == self.height:
            return Shape.SQUARE
        if self.width > self.height:
            return Shape.HORIZONTAL
        return Shape.VERTICAL

    def contains(self, x: int, y: int) -> bool:
        return self.x <= x < self.x + self.width and self.y <= y < self.y + self.height

    def cells(self, board_width: int) -> tuple[int, ...]:
        return tuple(
            yy * board_width + xx
            for yy in range(self.y, self.y + self.height)
            for xx in range(self.x, self.x + self.width)
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
        }

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Rectangle":
        return cls(
            x=int(value["x"]),
            y=int(value["y"]),
            width=int(value["width"]),
            height=int(value["height"]),
        )


@dataclass(frozen=True, slots=True)
class Clue:
    x: int
    y: int
    area: int
    shape: Shape | None = None

    def to_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"x": self.x, "y": self.y, "area": self.area}
        if self.shape is not None:
            result["shape"] = self.shape.value
        return result

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Clue":
        shape = value.get("shape")
        return cls(
            x=int(value["x"]),
            y=int(value["y"]),
            area=int(value["area"]),
            shape=Shape(shape) if shape is not None else None,
        )


@dataclass(frozen=True, slots=True)
class Level:
    width: int
    height: int
    clues: tuple[Clue, ...]
    solution: tuple[Rectangle, ...] = ()
    seed: int | None = None
    interest_score: float | None = None
    difficulty_score: float | None = None
    difficulty: str | None = None
    evaluation: dict[str, Any] | None = None

    def to_dict(self, include_solution: bool = True) -> dict[str, Any]:
        result: dict[str, Any] = {
            "version": 1,
            "width": self.width,
            "height": self.height,
            "clues": [clue.to_dict() for clue in self.clues],
        }
        if self.seed is not None:
            result["seed"] = self.seed
        if self.interest_score is not None:
            result["interestScore"] = round(self.interest_score, 2)
        if self.difficulty_score is not None:
            result["difficultyScore"] = round(self.difficulty_score, 2)
        if self.difficulty is not None:
            result["difficulty"] = self.difficulty
        if self.evaluation is not None:
            result["evaluation"] = self.evaluation
        if include_solution and self.solution:
            result["solution"] = [region.to_dict() for region in self.solution]
        return result

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "Level":
        return cls(
            width=int(value["width"]),
            height=int(value["height"]),
            clues=tuple(Clue.from_dict(item) for item in value["clues"]),
            solution=tuple(Rectangle.from_dict(item) for item in value.get("solution", [])),
            seed=value.get("seed"),
            interest_score=value.get("interestScore"),
            difficulty_score=value.get("difficultyScore"),
            difficulty=value.get("difficulty"),
            evaluation=value.get("evaluation"),
        )

