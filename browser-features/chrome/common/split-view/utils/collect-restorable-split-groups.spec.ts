/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { collectRestorableSplitGroups } from "./collect-restorable-split-groups.ts";

{
  const strip = [
    { id: "a1", groupId: "alpha", order: 1 },
    { id: "x", groupId: null, order: 99 },
    { id: "b1", groupId: "beta", order: 0 },
    { id: "a2", groupId: "alpha", order: 0 },
    { id: "b2", groupId: "beta", order: 1 },
    { id: "solo", groupId: "solo", order: 0 },
  ];
  const groups = collectRestorableSplitGroups(
    strip,
    4,
    (tab) => tab.groupId,
    (tabs) => [...tabs].sort((a, b) => a.order - b.order),
  );
  assert.deepEqual(groups, [
    {
      groupId: "alpha",
      tabs: [
        { id: "a2", groupId: "alpha", order: 0 },
        { id: "a1", groupId: "alpha", order: 1 },
      ],
    },
    {
      groupId: "beta",
      tabs: [
        { id: "b1", groupId: "beta", order: 0 },
        { id: "b2", groupId: "beta", order: 1 },
      ],
    },
  ]);
}

{
  const strip = [
    { id: "g1", groupId: "gamma", order: 0 },
    { id: "g2", groupId: "gamma", order: 1 },
    { id: "g3", groupId: "gamma", order: 2 },
  ];
  const groups = collectRestorableSplitGroups(
    strip,
    2,
    (tab) => tab.groupId,
    (tabs) => tabs,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.tabs.length, 2);
}

console.log("collect-restorable-split-groups.spec: ok");
