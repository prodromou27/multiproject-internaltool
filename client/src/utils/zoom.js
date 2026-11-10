import { useEffect } from 'react';
import { usePref } from './prefs';

/* Display size: the whole app drawn a little smaller or larger (CSS zoom on the page),
   chosen per person in Profile and kept with their other view preferences. 90% unless
   changed. Code that places something at the mouse or at an element's position on the
   screen divides by pageZoom(), since screen pixels and the page's pixels then differ. */
export const ZOOMS = Object.freeze([0.8, 0.9, 1, 1.1]);
export const DEFAULT_ZOOM = 0.9;
const valid = value => ZOOMS.includes(value);

export function applyZoom(value) {
  const zoom = valid(value) ? value : DEFAULT_ZOOM;
  document.documentElement.style.zoom = String(zoom);
  // Window-height sizes (100vh…) shrink with the zoom; CSS divides them by --zoom so they still fill the window.
  document.documentElement.style.setProperty('--zoom', String(zoom));
}

/** The page's zoom (1 when none). */
export function pageZoom() {
  const value = parseFloat(document.documentElement.style.zoom || getComputedStyle(document.documentElement).zoom);
  return value > 0 ? value : 1;
}

/** The person's display size, and a way to change it. */
export function useDisplaySize() {
  return usePref('display.zoom', valid, DEFAULT_ZOOM);
}

/** Applies the person's display size to the page (App). */
export function useDisplayZoom() {
  const [zoom] = useDisplaySize();
  useEffect(() => { applyZoom(zoom); }, [zoom]);
}
