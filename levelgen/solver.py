from __future__ import annotations

from dataclasses import dataclass
from math import log2

from .models import Clue, Level, Rectangle


@dataclass(frozen=True, slots=True)
class Candidate:
    clue_index: int
    rectangle: Rectangle
    mask: int


@dataclass(slots=True)
class SolverStats:
    search_nodes: int = 0
    branch_points: int = 0
    forced_moves: int = 0
    contradictions: int = 0
    max_depth: int = 0
    initial_candidate_counts: tuple[int, ...] = ()

    def to_dict(self) -> dict[str, int | float | list[int]]:
        counts = self.initial_candidate_counts
        return {
            "searchNodes": self.search_nodes,
            "branchPoints": self.branch_points,
            "forcedMoves": self.forced_moves,
            "contradictions": self.contradictions,
            "maxDepth": self.max_depth,
            "initialCandidateCounts": list(counts),
            "averageInitialCandidates": round(sum(counts) / len(counts), 3) if counts else 0.0,
            "candidateEntropy": round(sum(log2(max(1, count)) for count in counts), 3),
        }


@dataclass(frozen=True, slots=True)
class SolveResult:
    solution_count: int
    solutions: tuple[tuple[Rectangle, ...], ...]
    stats: SolverStats

    @property
    def is_unique(self) -> bool:
        return self.solution_count == 1


def _rectangle_mask(rectangle: Rectangle, width: int) -> int:
    mask = 0
    for cell in rectangle.cells(width):
        mask |= 1 << cell
    return mask


def enumerate_candidates(level: Level) -> tuple[tuple[Candidate, ...], ...]:
    """Enumerate every rectangle that can legally belong to each clue."""
    clue_positions = {(clue.x, clue.y) for clue in level.clues}
    result: list[tuple[Candidate, ...]] = []

    for clue_index, clue in enumerate(level.clues):
        candidates: list[Candidate] = []
        for height in range(1, level.height + 1):
            if clue.area % height:
                continue
            width = clue.area // height
            if width > level.width:
                continue
            for y in range(max(0, clue.y - height + 1), min(clue.y, level.height - height) + 1):
                for x in range(max(0, clue.x - width + 1), min(clue.x, level.width - width) + 1):
                    rectangle = Rectangle(x=x, y=y, width=width, height=height)
                    if clue.shape is not None and rectangle.shape is not clue.shape:
                        continue
                    contains_foreign_clue = any(
                        (cx, cy) != (clue.x, clue.y) and rectangle.contains(cx, cy)
                        for cx, cy in clue_positions
                    )
                    if contains_foreign_clue:
                        continue
                    candidates.append(
                        Candidate(
                            clue_index=clue_index,
                            rectangle=rectangle,
                            mask=_rectangle_mask(rectangle, level.width),
                        )
                    )
        candidates.sort(key=lambda candidate: (
            candidate.rectangle.y,
            candidate.rectangle.x,
            candidate.rectangle.height,
            candidate.rectangle.width,
        ))
        result.append(tuple(candidates))

    return tuple(result)


def solve_level(level: Level, max_solutions: int = 2) -> SolveResult:
    """Solve a level as an exact-cover problem, stopping at ``max_solutions``."""
    if max_solutions < 1:
        raise ValueError("max_solutions must be at least 1")
    if not level.clues:
        return SolveResult(0, (), SolverStats())

    positions: set[tuple[int, int]] = set()
    for clue in level.clues:
        if not (0 <= clue.x < level.width and 0 <= clue.y < level.height):
            raise ValueError(f"Clue ({clue.x}, {clue.y}) is outside the board")
        if clue.area < 1:
            raise ValueError("Clue area must be positive")
        if (clue.x, clue.y) in positions:
            raise ValueError(f"Several clues occupy ({clue.x}, {clue.y})")
        positions.add((clue.x, clue.y))

    candidates_by_clue = enumerate_candidates(level)
    stats = SolverStats(initial_candidate_counts=tuple(len(items) for items in candidates_by_clue))
    if sum(clue.area for clue in level.clues) != level.width * level.height:
        return SolveResult(0, (), stats)
    all_cells_mask = (1 << (level.width * level.height)) - 1
    solutions: list[tuple[Rectangle, ...]] = []

    def feasible_for_clue(clue_index: int, occupied: int) -> tuple[Candidate, ...]:
        return tuple(candidate for candidate in candidates_by_clue[clue_index] if not candidate.mask & occupied)

    def search(assigned: dict[int, Candidate], occupied: int, depth: int) -> None:
        if len(solutions) >= max_solutions:
            return
        stats.search_nodes += 1
        stats.max_depth = max(stats.max_depth, depth)

        local_assigned = dict(assigned)
        local_occupied = occupied

        while True:
            if len(local_assigned) == len(level.clues):
                if local_occupied == all_cells_mask:
                    solutions.append(tuple(local_assigned[index].rectangle for index in range(len(level.clues))))
                else:
                    stats.contradictions += 1
                return

            feasible: dict[int, tuple[Candidate, ...]] = {}
            forced: Candidate | None = None
            for clue_index in range(len(level.clues)):
                if clue_index in local_assigned:
                    continue
                choices = feasible_for_clue(clue_index, local_occupied)
                if not choices:
                    stats.contradictions += 1
                    return
                feasible[clue_index] = choices
                if len(choices) == 1:
                    forced = choices[0]
                    break

            if forced is None:
                uncovered = all_cells_mask & ~local_occupied
                while uncovered:
                    least_bit = uncovered & -uncovered
                    covering: list[Candidate] = []
                    for choices in feasible.values():
                        covering.extend(candidate for candidate in choices if candidate.mask & least_bit)
                    if not covering:
                        stats.contradictions += 1
                        return
                    if len(covering) == 1:
                        forced = covering[0]
                        break
                    uncovered ^= least_bit

            if forced is None:
                break
            if forced.clue_index in local_assigned or forced.mask & local_occupied:
                stats.contradictions += 1
                return
            local_assigned[forced.clue_index] = forced
            local_occupied |= forced.mask
            stats.forced_moves += 1

        # Branch on the tightest clue or uncovered cell constraint.
        branch_choices = min(feasible.values(), key=len)
        uncovered = all_cells_mask & ~local_occupied
        while uncovered:
            least_bit = uncovered & -uncovered
            covering = tuple(
                candidate
                for choices in feasible.values()
                for candidate in choices
                if candidate.mask & least_bit
            )
            if len(covering) < len(branch_choices):
                branch_choices = covering
            uncovered ^= least_bit

        stats.branch_points += 1
        for candidate in branch_choices:
            if len(solutions) >= max_solutions:
                return
            next_assigned = dict(local_assigned)
            next_assigned[candidate.clue_index] = candidate
            search(next_assigned, local_occupied | candidate.mask, depth + 1)

    search({}, 0, 0)
    return SolveResult(len(solutions), tuple(solutions), stats)
