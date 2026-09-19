# TRACE design specification

Reference: concept.png (1536 × 1024). Built-in Image Gen concept, generated for this application.

- Background #f1f5f9, surfaces white, text #0c1930, secondary #617087, teal #147d73, borders #dbe2ea.
- System Japanese sans serif; title 30px/1.4 bold; section heading 17px; controls 14px; captions 12px.
- White 66px header, overlapping-square mark, TRACE / PDF to DXF, local-processing label.
- Intro, then 70/30 preview/settings columns with 16px gap; modest 6–8px radii.
- Preview toolbar, page navigation, PDF/DXF tabs, graph-paper canvas, white document, dimension footer.
- Sidebar: PDF drop zone and sample button; output page and scale controls; text/color switches; output format and export.
- Empty state uses the same canvas. No document is preloaded: sample is a genuine generated PDF chosen by the user.
- Mobile: preview followed by settings in one column; toolbar wraps. All controls remain usable.
- Functional deviations: no fake operating-system window buttons; output format is read-only (only R2010/mm supported); actual sample drawing replaces conceptual artwork; status/errors and extraction counts added as necessary workflow feedback; a limits disclosure explains conversion fidelity.
- UI and all drawing content are native HTML/SVG or rendered real PDF, never the concept bitmap.

Concept brief: full Japanese local PDF-to-DXF tool, page selection, scale, PDF/DXF preview, file drop, sample, text/color controls, R2010/mm export; white/cool-gray/teal, restrained drafting workspace, no marketing panels.
