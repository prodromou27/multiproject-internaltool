import { useEffect } from 'react';

/* A wide table scrolls sideways inside its .table-wrap (mostly on phones). Someone
   using the keyboard can only scroll it if the wrapper can take focus, so a wrapper
   that actually scrolls gets a tab stop and a name (the table's caption); one that
   fits loses them again, so it adds no extra tab stop. */
function update(wrap) {
  const scrolls = wrap.scrollWidth > wrap.clientWidth + 1;
  if (scrolls && !wrap.hasAttribute('tabindex')) {
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('role', 'region');
    const caption = wrap.querySelector('caption')?.textContent?.trim();
    wrap.setAttribute('aria-label', caption || 'Table, scrolls sideways');
    wrap.dataset.scrollFocus = '1';
  } else if (!scrolls && wrap.dataset.scrollFocus) {
    ['tabindex', 'role', 'aria-label', 'data-scroll-focus'].forEach(name => wrap.removeAttribute(name));
  }
}

export function useScrollableTables() {
  useEffect(() => {
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => document.querySelectorAll('.table-wrap').forEach(update));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', check);
    check();
    return () => { observer.disconnect(); window.removeEventListener('resize', check); cancelAnimationFrame(frame); };
  }, []);
}
