#!/usr/bin/env python3
"""Compatibility shim: implementation lives in ecc_dashboard_runtime.py."""

from pathlib import Path

_impl = Path(__file__).with_name("ecc_dashboard_runtime.py")
exec(compile(_impl.read_text(encoding="utf-8"), str(_impl), "exec"), globals())
