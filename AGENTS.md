# Project architecture rules

- Resolve person and organization chip linkability through `get_linkable_entities` in one batched request, because per-card or per-kind reads slow search result rendering.
- Background runners must re-read shared control state before persisting telemetry, because an in-flight whole-object write can undo an external pause.