/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Sort tabs belonging to one split group for session restore: primary key is
 * persisted pane index (0..n-1); missing index falls back to left-to-right strip order.
 */
export function orderSplitGroupTabsForRestore<T>(
  groupTabs: readonly T[],
  stripOrderedAllTabs: readonly T[],
  getPaneIndex: (tab: T) => number | undefined,
): T[] {
  const stripIndex = new Map<T, number>();
  for (let i = 0; i < stripOrderedAllTabs.length; i++) {
    stripIndex.set(stripOrderedAllTabs[i]!, i);
  }
  const LARGE = 1e9;
  return [...groupTabs].sort((a, b) => {
    const ia = getPaneIndex(a);
    const ib = getPaneIndex(b);
    const ra = typeof ia === "number" && Number.isFinite(ia) ? ia : LARGE;
    const rb = typeof ib === "number" && Number.isFinite(ib) ? ib : LARGE;
    if (ra !== rb) {
      return ra - rb;
    }
    return (stripIndex.get(a) ?? 0) - (stripIndex.get(b) ?? 0);
  });
}
