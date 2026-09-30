// Leaflet builds custom marker icons (L.divIcon) and popups (bindPopup) from
// raw HTML strings assembled across the map/** layer files, using
// style="..." attributes to apply per-record, runtime-computed colors/sizes
// (severity, magnitude, status, etc). A CSP without style-src 'unsafe-inline'
// blocks the browser from applying any of those style="" attributes.
//
// Rather than rewriting every dynamic color/size combination in every layer
// file into a fixed set of CSS classes, this patches Leaflet's two HTML
// insertion points (DivIcon.createIcon and Layer.bindPopup) so that any
// style="..." attribute is stripped out of the HTML *before* it ever reaches
// the DOM, then reapplied per-element via el.style.setProperty(). Per-property
// CSSOM assignment (unlike the style="" attribute or el.style.cssText) isn't
// governed by CSP's style-src, so this keeps every layer file's existing
// dynamic-styling logic working unchanged under a strict CSP.

let uid = 0;

function stripInlineStyles(html) {
  const styles = [];
  const strippedHtml = html.replace(/\s+style="([^"]*)"/g, (_match, css) => {
    const id = `csp-style-${uid++}`;
    styles.push({ id, css });
    return ` data-csp-style-id="${id}"`;
  });
  return { html: strippedHtml, styles };
}

function parseDeclarations(css) {
  return css
    .split(";")
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const idx = decl.indexOf(":");
      if (idx === -1) return null;
      return [decl.slice(0, idx).trim(), decl.slice(idx + 1).trim()];
    })
    .filter(Boolean);
}

function findByStyleId(root, id) {
  if (root.getAttribute && root.getAttribute("data-csp-style-id") === id) {
    return root;
  }
  return root.querySelector(`[data-csp-style-id="${id}"]`);
}

function applyExtractedStyles(root, styles) {
  if (!root || !styles || styles.length === 0) return;
  for (const { id, css } of styles) {
    const el = findByStyleId(root, id);
    if (!el) continue;
    el.removeAttribute("data-csp-style-id");
    for (const [prop, value] of parseDeclarations(css)) {
      try {
        el.style.setProperty(prop, value);
      } catch {
        // Malformed declaration (shouldn't happen with our own templates) — skip it.
      }
    }
  }
}

// Patches Leaflet's prototypes once per L instance — no changes needed in any
// individual map layer file. Call this before any map mounts. The app loads
// two independent copies of Leaflet (the npm-bundled one used by BaseMap.jsx,
// and a CDN-loaded one in LocationPicker/leafletLoader.js), each with its own
// DivIcon/Layer classes, so the "already patched" guard is tracked on the L
// object itself rather than as module state shared between the two.
export function installLeafletCspFix(L) {
  if (L.__cspFixInstalled) return;
  L.__cspFixInstalled = true;

  const originalCreateIcon = L.DivIcon.prototype.createIcon;
  L.DivIcon.prototype.createIcon = function (oldIcon) {
    const original = this.options.html;
    if (typeof original !== "string") {
      return originalCreateIcon.call(this, oldIcon);
    }
    const { html, styles } = stripInlineStyles(original);
    this.options.html = html;
    const div = originalCreateIcon.call(this, oldIcon);
    this.options.html = original;
    applyExtractedStyles(div, styles);
    return div;
  };

  const originalBindPopup = L.Layer.prototype.bindPopup;
  L.Layer.prototype.bindPopup = function (content, options) {
    if (typeof content === "string") {
      const { html, styles } = stripInlineStyles(content);
      this._cspInlineStyles = styles;
      return originalBindPopup.call(this, html, options);
    }
    return originalBindPopup.call(this, content, options);
  };
}

// Registers the map-level listener that applies the styles stashed by the
// bindPopup patch above once a popup's content actually lands in the DOM.
// Returns a cleanup function to remove the listener (e.g. from a useEffect).
export function installPopupStyleListener(map) {
  const handler = (e) => {
    const styles = e.popup?._source?._cspInlineStyles;
    if (styles) applyExtractedStyles(e.popup.getElement(), styles);
  };
  map.on("popupopen", handler);
  return () => map.off("popupopen", handler);
}
