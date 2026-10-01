# Product-Owned Context Folio Contract

`context-folio.js` owns only presentation lifecycle: one active section, open/closed state, dialog semantics, focus containment, Escape/Close dismissal, and focus return to the initiating portal.

It does not own queue, metadata, audio, output, tuning, settings, systems, playback, or library state. The host receives `onSectionChange(section)` and mounts product-owned content and commands. A theme may style the surface and place the portals, but may not inject authoritative values or bypass host actions.

Required behavior:

- portals use stable lowercase section keys and literal accessible labels;
- at most one folio section is active;
- opening sets `aria-expanded`, exposes the dialog, and moves focus inside;
- Escape and Close hide/inert the surface and return focus to the initiating portal;
- Tab remains within the open surface;
- narrow layout may become a full-screen sheet without changing ownership;
- failure leaves the ordinary product workflow reachable;
- destroy removes listeners and leaves the surface hidden/inert;
- non-active themes have no visible or stateful effect.

The safe fallback is the existing product drawer, panel, dialog, or settings route for the requested job.
