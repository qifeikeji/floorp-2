/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { resetSplitPanelPresentationState } from "./reset-split-panel-presentation.ts";

class FakeClassList {
  constructor(private readonly names: Set<string>) {}

  contains(name: string): boolean {
    return this.names.has(name);
  }

  remove(...names: string[]): void {
    for (const name of names) {
      this.names.delete(name);
    }
  }
}

class FakePanel {
  readonly classNames: Set<string>;
  readonly attrs: Set<string>;
  readonly classList: FakeClassList;

  constructor(classNames: string[], attrs: string[]) {
    this.classNames = new Set(classNames);
    this.attrs = new Set(attrs);
    this.classList = new FakeClassList(this.classNames);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
}

{
  const panel = new FakePanel(
    ["split-view-panel", "split-view-panel-active", "deck-selected"],
    [
      "column",
      "data-floorp-active-pane",
      "data-floorp-drag-source",
      "data-floorp-drop-target",
    ],
  );
  assert.equal(resetSplitPanelPresentationState(panel), true);
  assert.equal(panel.classList.contains("split-view-panel"), false);
  assert.equal(panel.classList.contains("split-view-panel-active"), false);
  assert.equal(panel.classList.contains("deck-selected"), false);
  assert.equal(panel.hasAttribute("column"), false);
  assert.equal(panel.hasAttribute("data-floorp-active-pane"), false);
  assert.equal(panel.hasAttribute("data-floorp-drag-source"), false);
  assert.equal(panel.hasAttribute("data-floorp-drop-target"), false);
}

{
  const panel = new FakePanel(["deck-selected"], []);
  assert.equal(resetSplitPanelPresentationState(panel), false);
  assert.equal(panel.classList.contains("deck-selected"), true);
}

console.log("reset-split-panel-presentation.spec: ok");
