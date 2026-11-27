"""Optional pytest fixtures for fireemu Test Worlds."""

from __future__ import annotations

from typing import Any, Iterator

from . import TestWorld, create_test_world


def make_pytest_fixtures(**world_kwargs: Any):
    """Create a `(fireemu_world, fireemu)` pair of pytest fixtures (session-scoped world + per-test state rewind)."""
    import pytest  # type: ignore[import-not-found]

    used = {"first": True}

    @pytest.fixture(scope="session")
    def fireemu_world() -> Iterator[TestWorld]:
        with create_test_world(**world_kwargs) as world:
            yield world

    @pytest.fixture()
    def fireemu(fireemu_world: TestWorld) -> TestWorld:
        if used["first"]:
            used["first"] = False
        else:
            fireemu_world.reset_state()
        return fireemu_world

    return fireemu_world, fireemu
