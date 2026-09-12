"""Public API for the zone puzzle level generator."""

from .generator import GeneratorConfig, LevelGenerator
from .models import Clue, Level, Rectangle, Shape
from .scoring import Evaluation, evaluate_level
from .solver import SolveResult, solve_level

__all__ = [
    "Clue",
    "Evaluation",
    "GeneratorConfig",
    "Level",
    "LevelGenerator",
    "Rectangle",
    "Shape",
    "SolveResult",
    "evaluate_level",
    "solve_level",
]

