# Project architecture rules

- Resolve person and organization chip linkability through `get_linkable_entities` in one batched request, because per-card or per-kind reads slow search result rendering.