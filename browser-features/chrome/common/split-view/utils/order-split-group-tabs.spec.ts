/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { orderSplitGroupTabsForRestore } from "./order-split-group-tabs.ts";

{
  const strip = ["a", "b", "c", "d"] as const;
  const group = ["c", "a", "d", "b"];
  const idx = new Map<string, number>([
    ["a", 0],
    ["b", 1],
    ["c", 2],
    ["d", 3],
  ]);
  const got = orderSplitGroupTabsForRestore(group, strip, (t) => idx.get(t));
  assert.deepEqual(got, ["a", "b", "c", "d"]);
}

{
  const strip = ["x", "a", "y", "b", "z"];
  const group = ["b", "a"];
  const got = orderSplitGroupTabsForRestore(group, strip, () => undefined);
  assert.deepEqual(got, ["a", "b"]);
}

console.log("order-split-group-tabs.spec: ok");
