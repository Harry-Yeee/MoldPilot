"use client";

import { useEffect, useState } from "react";
import { sectionHueVars, type StatusTone } from "@/components/ui/status-colors";
import { pickLabel, type Locale } from "@/domain/mold-trial/labels";

/**
 * The project page's desktop section rail (lg and up only).
 *
 * Training feedback: the page shows everything at once and gives no sense of
 * where you are or what matters. The rail answers both — one entry per section
 * the server page actually rendered (including one entry per trial), a hue
 * swatch that matches that section's left rule and header band (dual coding:
 * colour *and* position, never colour alone), and a small alert dot when the
 * section is holding a pending action.
 *
 * The only client-side behaviour in this feature: an IntersectionObserver that
 * highlights the entry you are currently looking at. Navigation itself is plain
 * anchor jumps — smooth scrolling is CSS (`scroll-behavior`), so nothing here
 * scrolls the page by hand. Below lg the whole component is `hidden`, so the
 * phone renders exactly what it rendered before this existed.
 */

export type ProjectSectionNavItem = {
  /** DOM id of the section this entry jumps to. */
  id: string;
  labelEn: string;
  labelZh: string;
  /** Section hue — the same tone the section's left rule + header band use. */
  tone: StatusTone;
  /** A pending action inside this section (amber = waiting, red = overdue/returned). */
  badge?: {
    tone: StatusTone;
    labelEn: string;
    labelZh: string;
  };
};

export type ProjectSectionNavProps = {
  items: readonly ProjectSectionNavItem[];
  locale: Locale;
  /** Bilingual rail heading, already picked for the active language. */
  title: string;
};

export function ProjectSectionNav({ items, locale, title }: ProjectSectionNavProps) {
  const [activeId, setActiveId] = useState<string>(items[0]?.id ?? "");
  // Stable primitive dep: the effect re-runs only when the section list itself
  // changes, not on every parent re-render.
  const idKey = items.map((item) => item.id).join("|");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const ids = idKey.split("|").filter((id) => id.length > 0);
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element != null);

    if (elements.length === 0) {
      return;
    }

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.add(entry.target.id);
          } else {
            visible.delete(entry.target.id);
          }
        }

        // Document order wins, so the highlight is the topmost section in view.
        const topmost = ids.find((id) => visible.has(id));
        if (topmost != null) {
          setActiveId(topmost);
        }
      },
      // Ignore the top strip (where the sticky rail sits) and the bottom 55% of
      // the viewport, so "active" means "the section you are reading".
      { rootMargin: "-72px 0px -55% 0px", threshold: 0 }
    );

    for (const element of elements) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [idKey]);

  if (items.length === 0) {
    return null;
  }

  return (
    <nav className="projectSectionNav hidden lg:block" aria-label={title}>
      <div className="projectSectionNavInner">
        <p className="projectSectionNavTitle">{title}</p>
        <ul className="projectSectionNavList">
          {items.map((item) => {
            const label = pickLabel({ en: item.labelEn, zh: item.labelZh }, locale);
            const isActive = item.id === activeId;

            // Poster convention: both languages always visible — zh primary,
            // en as a small secondary line (skipped when identical). The rail
            // is a wayfinding device for a mixed-literacy crew; it should not
            // depend on the language switcher to be readable.
            const primary = item.labelZh;
            const secondary = item.labelEn !== item.labelZh ? item.labelEn : null;

            return (
              <li key={item.id}>
                <a
                  className={isActive ? "projectSectionNavLink isActive" : "projectSectionNavLink"}
                  href={`#${item.id}`}
                  aria-current={isActive ? "true" : undefined}
                  aria-label={label}
                  style={sectionHueVars(item.tone)}
                >
                  <span className="projectSectionNavSwatch" aria-hidden="true" />
                  <span className="projectSectionNavText">
                    <span className="projectSectionNavZh">{primary}</span>
                    {secondary == null ? null : <span className="projectSectionNavEn">{secondary}</span>}
                  </span>
                  {item.badge == null ? null : (
                    <span
                      className="projectSectionNavAlert"
                      style={sectionHueVars(item.badge.tone)}
                      title={pickLabel({ en: item.badge.labelEn, zh: item.badge.labelZh }, locale)}
                    >
                      <span className="sr-only">
                        {pickLabel({ en: item.badge.labelEn, zh: item.badge.labelZh }, locale)}
                      </span>
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
