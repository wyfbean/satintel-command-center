__all__ = ["skyeyegpt", "sarmae", "dofa", "sattxt", "mtp"]


def __getattr__(name: str):
    if name in __all__:
        from . import remote_models

        return getattr(remote_models, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
