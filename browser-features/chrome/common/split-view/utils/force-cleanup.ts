/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Belt-and-suspenders cleanup of all split-view drag-related state that can
 * leak across event races (e.g. Firefox Bugzilla #656164 where `dragend`
 * doesn't fire when a tab is consumed by a drop handler, or when a tab is
 * detached to a new window). When any of these attributes or overlay
 * elements lingers, it applies `pointer-events: none` to web content (via
 * `split-view.css` and Firefox's own `browser.css`) and blocks all mouse
 * input on the page until the browser is restarted.
 *
 * This helper is intentionally idempotent and side-effect-free when nothing
 * is leaked — safe to call on every drag/drop/mouseup/blur event.
 *
 * Coverage:
 * - `#tabbrowser-tabpanels[data-floorp-dragging]` (splitter / pane reorder)
 * - `#tabbrowser-tabpanels[data-floorp-tab-dragging]` (tab drop)
 * - `#tabbrowser-tabs[movingtab]` and `#navigator-toolbox[movingtab]`
 *   (Firefox-native leftover; `browser.css` applies `pointer-events: none`
 *   to `#navigator-toolbox[movingtab]`)
 * - `#floorp-split-drop-overlay` element appended to `documentElement`
 * - `#floorp-new-window-drop-zone` element appended to `documentElement`
 *
 * See: Floorp PR #2492, Firefox Bugzilla #656164.
 */
export function forceCleanupDragState(
  logger: ConsoleInstance | null = null,
): void {
  try {
    const tabpanels = document?.getElementById(
      "tabbrowser-tabpanels",
    ) as HTMLElement | null;
    if (tabpanels) {
      if (tabpanels.hasAttribute("data-floorp-dragging")) {
        tabpanels.removeAttribute("data-floorp-dragging");
        logger?.debug("[force-cleanup] removed lingering data-floorp-dragging");
      }
      if (tabpanels.hasAttribute("data-floorp-tab-dragging")) {
        tabpanels.removeAttribute("data-floorp-tab-dragging");
        logger?.debug(
          "[force-cleanup] removed lingering data-floorp-tab-dragging",
        );
      }
    }

    // Firefox's `browser.css` targets `#tabbrowser-tabs[movingtab]` and
    // `#navigator-toolbox[movingtab]` (NOT tabpanels), so sweep those.
    const tabbrowserTabs = document?.getElementById("tabbrowser-tabs");
    if (tabbrowserTabs?.hasAttribute("movingtab")) {
      tabbrowserTabs.removeAttribute("movingtab");
      logger?.debug("[force-cleanup] removed lingering movingtab on tabs");
    }
    const navigatorToolbox = document?.getElementById("navigator-toolbox");
    if (navigatorToolbox?.hasAttribute("movingtab")) {
      navigatorToolbox.removeAttribute("movingtab");
      logger?.debug("[force-cleanup] removed lingering movingtab on toolbox");
    }

    const overlay = document?.getElementById("floorp-split-drop-overlay");
    if (overlay) {
      overlay.remove();
      logger?.debug("[force-cleanup] removed lingering split-drop overlay");
    }
    const newWindowZone = document?.getElementById(
      "floorp-new-window-drop-zone",
    );
    if (newWindowZone) {
      newWindowZone.remove();
      logger?.debug(
        "[force-cleanup] removed lingering new-window drop zone",
      );
    }
  } catch (err) {
    // Never throw from a safety-net cleanup; log and continue.
    try {
      logger?.error("[force-cleanup] unexpected error:", err);
    } catch {
      // ignore logger failures
    }
  }
}
