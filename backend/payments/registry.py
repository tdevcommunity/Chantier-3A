"""Register and resolve payment providers by name."""

from __future__ import annotations

from payments.types import (
    PROVIDER_NAME_FREE,
    PROVIDER_NAME_MANUAL,
    PROVIDER_NAME_MANUAL_MOMO,
    Capabilities,
    Provider,
)


class Registry:
    """Registry."""
    def __init__(self, enabled: dict[str, bool] | None = None) -> None:
        """Initialize ``Registry``."""
        self._providers: dict[str, Provider] = {}
        self._enabled = enabled

    @classmethod
    def from_env(cls, env: str) -> Registry:
        """From env on ``Registry``."""
        enabled: dict[str, bool] = {}
        any_name = False
        for part in env.split(","):
            name = part.strip().lower()
            if not name:
                continue
            enabled[name] = True
            any_name = True
        if any_name:
            enabled[PROVIDER_NAME_MANUAL] = True
            enabled[PROVIDER_NAME_MANUAL_MOMO] = True
            enabled[PROVIDER_NAME_FREE] = True
            return cls(enabled=enabled)
        return cls()

    def register(self, provider: Provider) -> None:
        """Register on ``Registry``."""
        self._providers[provider.name()] = provider

    def get(self, name: str) -> Provider | None:
        """Get on ``Registry``."""
        return self._providers.get(name)

    def names(self) -> list[str]:
        """Names on ``Registry``."""
        return sorted(self._providers.keys())

    def is_enabled(self, name: str) -> bool:
        """Is enabled on ``Registry``."""
        if name in (PROVIDER_NAME_MANUAL, PROVIDER_NAME_MANUAL_MOMO, PROVIDER_NAME_FREE):
            return True
        if self._enabled is None:
            return True
        return self._enabled.get(name.lower(), False)

    def list_enabled(self) -> list[Provider]:
        """List enabled on ``Registry``."""
        out: list[Provider] = []
        for name in self.names():
            if self.is_enabled(name):
                out.append(self._providers[name])
        return out
