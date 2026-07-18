/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared re-entrancy guard state for monkey-patched setters.
 * Passed by reference (plain object) into patch closures so that
 * multiple patches can coordinate without circular dependencies.
 */
export interface PatchState {
  inSplitViewPanelsSet: boolean;
  inShowSplitViewPanels: boolean;
  lastPanelIds: string;
  /** Whether split-view set the multibar attribute on #TabsToolbar.
   *  Used to avoid removing it if multirow tabs set it first. */
  multibarSetBySplitView: boolean;
}

export function createPatchState(): PatchState {
  return {
    inSplitViewPanelsSet: false,
    inShowSplitViewPanels: false,
    lastPanelIds: "",
    multibarSetBySplitView: false,
  };
}
