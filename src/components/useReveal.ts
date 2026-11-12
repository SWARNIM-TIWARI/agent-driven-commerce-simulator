'use client'
import { useEffect } from 'react'

/** Scroll-triggered reveals. Content is only hidden once JS has run (html.js), and never under reduced motion.
 *  Pass values that add new [data-reveal] elements (e.g. run results) so they get observed too. */
export function useReveal(deps: unknown[] = []) {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target) }
    }, { threshold: 0.05 })
    document.documentElement.classList.add('js')
    document.querySelectorAll<HTMLElement>('[data-reveal]:not(.in)').forEach(el => io.observe(el))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
