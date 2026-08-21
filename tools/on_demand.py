"""Thread-safe lifecycle for resources that are expensive to keep in memory."""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Callable, Generic, Iterator, TypeVar


Resource = TypeVar("Resource")


class ResourceNotReady(RuntimeError):
    """Raised when a caller tries to use a resource before it is loaded."""


@dataclass(frozen=True)
class ResourceStatus:
    ready: bool
    loading: bool
    error: str | None


class OnDemandResource(Generic[Resource]):
    """Load once on demand, serialize use, and release after an idle period.

    The loader runs in a daemon thread so a wake request can return immediately.
    A separate usage lock prevents an idle release from racing an inference call.
    """

    def __init__(
        self,
        loader: Callable[[], Resource],
        releaser: Callable[[Resource], None],
        *,
        idle_seconds: float,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        if idle_seconds <= 0:
            raise ValueError("idle_seconds must be positive")
        self._loader = loader
        self._releaser = releaser
        self._idle_seconds = idle_seconds
        self._monotonic = monotonic
        self._state_lock = threading.Lock()
        self._usage_lock = threading.Lock()
        self._resource: Resource | None = None
        self._loading = False
        self._error: str | None = None
        self._last_activity = monotonic()

    def status(self) -> ResourceStatus:
        with self._state_lock:
            return self._status_locked()

    def wake(self) -> ResourceStatus:
        """Begin loading when necessary without extending a ready resource."""
        with self._state_lock:
            # A public wake endpoint must not become a keep-warm endpoint. Once
            # ready, only actual resource use refreshes the idle deadline.
            if self._resource is not None:
                return self._status_locked()
            self._last_activity = self._monotonic()
            if self._loading:
                return self._status_locked()
            self._loading = True
            self._error = None

        threading.Thread(
            target=self._load,
            name="on-demand-resource-loader",
            daemon=True,
        ).start()
        return self.status()

    def _load(self) -> None:
        try:
            resource = self._loader()
        except Exception as exc:
            with self._state_lock:
                self._loading = False
                self._error = type(exc).__name__
            return

        with self._usage_lock, self._state_lock:
            self._resource = resource
            self._loading = False
            self._error = None
            self._last_activity = self._monotonic()

    @contextmanager
    def use(self) -> Iterator[Resource]:
        """Hold the resource so the idle monitor cannot release it mid-use."""
        with self._usage_lock:
            with self._state_lock:
                resource = self._resource
                if resource is None:
                    raise ResourceNotReady("resource is not ready")
                self._last_activity = self._monotonic()
            try:
                yield resource
            finally:
                with self._state_lock:
                    self._last_activity = self._monotonic()

    def release_if_idle(self) -> bool:
        """Release a ready resource when its deadline has passed."""
        with self._state_lock:
            if not self._idle_due_locked():
                return False

        with self._usage_lock:
            with self._state_lock:
                if not self._idle_due_locked():
                    return False
                resource = self._resource
                self._resource = None
            if resource is not None:
                self._releaser(resource)
                return True
        return False

    def release_now(self) -> bool:
        """Release immediately, waiting for an in-flight user to finish."""
        with self._usage_lock:
            with self._state_lock:
                resource = self._resource
                self._resource = None
            if resource is not None:
                self._releaser(resource)
                return True
        return False

    def empty_and_idle(self) -> bool:
        """Return whether an unloaded/failed resource has also gone idle."""
        with self._state_lock:
            return (
                self._resource is None
                and not self._loading
                and self._monotonic() - self._last_activity >= self._idle_seconds
            )

    def _idle_due_locked(self) -> bool:
        return (
            self._resource is not None
            and not self._loading
            and self._monotonic() - self._last_activity >= self._idle_seconds
        )

    def _status_locked(self) -> ResourceStatus:
        return ResourceStatus(
            ready=self._resource is not None,
            loading=self._loading,
            error=self._error,
        )
