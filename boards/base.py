from __future__ import annotations

from abc import ABC, abstractmethod


class BoardAdapter(ABC):
    @abstractmethod
    def fetch(self, role: str, location: str) -> list[dict]:
        raise NotImplementedError