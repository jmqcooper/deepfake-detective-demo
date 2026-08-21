from __future__ import annotations

import threading
import time
import unittest

from tools.on_demand import OnDemandResource, ResourceNotReady, ResourceStatus


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def wait_for(manager: OnDemandResource[object], predicate) -> ResourceStatus:
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline:
        status = manager.status()
        if predicate(status):
            return status
        time.sleep(0.001)
    return manager.status()


class OnDemandResourceTests(unittest.TestCase):
    def test_wake_loads_once_and_release_waits_for_idle_deadline(self) -> None:
        clock = Clock()
        loaded = threading.Event()
        releases: list[object] = []
        resource = object()

        def load() -> object:
            loaded.set()
            return resource

        manager = OnDemandResource(
            load,
            releases.append,
            idle_seconds=10,
            monotonic=clock,
        )

        initial = manager.wake()
        self.assertTrue(initial.loading or initial.ready)
        self.assertTrue(loaded.wait(1))
        self.assertTrue(wait_for(manager, lambda status: status.ready).ready)

        manager.wake()
        clock.now = 9
        self.assertFalse(manager.release_if_idle())
        clock.now = 10
        self.assertTrue(manager.release_if_idle())
        self.assertEqual(releases, [resource])
        self.assertFalse(manager.status().ready)

    def test_use_refreshes_activity_and_blocks_early_release(self) -> None:
        clock = Clock()
        loaded = threading.Event()
        manager = OnDemandResource(
            lambda: loaded.set() or "model",
            lambda _: None,
            idle_seconds=5,
            monotonic=clock,
        )
        manager.wake()
        self.assertTrue(loaded.wait(1))
        self.assertTrue(wait_for(manager, lambda status: status.ready).ready)

        clock.now = 4
        with manager.use() as value:
            self.assertEqual(value, "model")
            clock.now = 20
        self.assertFalse(manager.release_if_idle())
        clock.now = 25
        self.assertTrue(manager.release_if_idle())

    def test_failed_load_can_be_retried(self) -> None:
        attempts = 0
        finished = threading.Event()

        def load() -> str:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                finished.set()
                raise ValueError("no model")
            finished.set()
            return "ready"

        manager = OnDemandResource(load, lambda _: None, idle_seconds=10)
        manager.wake()
        self.assertTrue(finished.wait(1))
        status = wait_for(manager, lambda value: not value.loading)
        self.assertEqual(status.error, "ValueError")

        finished.clear()
        manager.wake()
        self.assertTrue(finished.wait(1))
        self.assertTrue(wait_for(manager, lambda status: status.ready).ready)
        self.assertEqual(attempts, 2)

    def test_use_before_load_raises(self) -> None:
        clock = Clock()
        manager = OnDemandResource(
            lambda: "model",
            lambda _: None,
            idle_seconds=10,
            monotonic=clock,
        )
        self.assertFalse(manager.empty_and_idle())
        clock.now = 10
        self.assertTrue(manager.empty_and_idle())
        with self.assertRaises(ResourceNotReady):
            with manager.use():
                pass


if __name__ == "__main__":
    unittest.main()
