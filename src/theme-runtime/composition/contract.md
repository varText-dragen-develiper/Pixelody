# Context folio contract

`context-folio.js` manages the presentation of one open section: dialog state, focus containment, Escape/Close and return to the initiating portal. The host receives `onSectionChange(section)` and supplies the actual content/actions. Queue, metadata, audio, output, tuning, settings and library data remain with their existing owners.

Portals use stable lowercase keys and literal accessible names. Opening sets aria-expanded, exposes the dialog and moves focus inside; Tab stays within it. Escape/Close hides and inerts it, returning focus. Only one section is active. Narrow layouts can use a full-screen sheet without changing ownership.

Themes may style the folio and position portals, but can't inject factual values or bypass actions. Other themes must receive no residual state or visible HUD. Destroy removes listeners and leaves the surface hidden/inert. A failure returns the requested function to its ordinary drawer, panel, dialog or settings route.
