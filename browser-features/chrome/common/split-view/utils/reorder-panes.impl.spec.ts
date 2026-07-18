/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { reorderSplitTabsForDesiredOrderImpl } from "./reorder-strip-impl.ts";

function moveTabBeforeInArray(
  tabs: string[],
  tab: string,
  before: string | null,
): void {
  const from = tabs.indexOf(tab);
  if (from < 0) {
    return;
  }
  tabs.splice(from, 1);
  if (before === null) {
    tabs.push(tab);
    return;
  }
  const to = tabs.indexOf(before);
  if (to < 0) {
    tabs.push(tab);
    return;
  }
  tabs.splice(to, 0, tab);
}

const cases: { strip: string[]; desired: string[]; want: string[] }[] = [
  {
    strip: ["A", "B", "C", "D"],
    desired: ["B", "C", "A", "D"],
    want: ["B", "C", "A", "D"],
  },
  {
    strip: ["X", "Y", "A", "B", "C", "D", "Z"],
    desired: ["C", "A", "B", "D"],
    want: ["X", "Y", "C", "A", "B", "D", "Z"],
  },
  {
    strip: ["A", "B", "C", "D"],
    desired: ["D", "C", "B", "A"],
    want: ["D", "C", "B", "A"],
  },
  {
    strip: ["A", "B", "C", "D"],
    desired: ["A", "C", "B", "D"],
    want: ["A", "C", "B", "D"],
  },
];

for (const { strip, desired, want } of cases) {
  const tabs = [...strip];
  reorderSplitTabsForDesiredOrderImpl(
    () => tabs,
    (t, b) => moveTabBeforeInArray(tabs, t, b),
    desired,
  );
  assert.deepEqual(tabs, want);
}

console.log("reorder-panes.impl.spec: ok");
