"""Study preparation: polished notes and a checklist plan from source material.

The package is intentionally independent of the WebStudy service layer. The
FastAPI router and the async run manager are the only entry points used by the
web application; the Android bridge never imports this package.
"""

from __future__ import annotations

__all__ = ["__version__"]

__version__ = "1"
