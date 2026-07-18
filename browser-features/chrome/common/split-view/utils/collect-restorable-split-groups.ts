/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export type RestorableSplitGroup<TTab> = {
  groupId: string;
  tabs: TTab[];
};

export function collectRestorableSplitGroups<TTab>(
  allTabs: TTab[],
  maxPanes: number,
  getGroupId: (tab: TTab) => string | null,
  orderTabs: (tabs: TTab[], allTabs: TTab[]) => TTab[],
): RestorableSplitGroup<TTab>[] {
  const groupBuckets = new Map<string, TTab[]>();
  const groupOrder: string[] = [];
  for (const tab of allTabs) {
    const gid = getGroupId(tab);
    if (!gid) {
      continue;
    }
    const arr = groupBuckets.get(gid);
    if (arr) {
      arr.push(tab);
    } else {
      groupBuckets.set(gid, [tab]);
      groupOrder.push(gid);
    }
  }

  const groups: RestorableSplitGroup<TTab>[] = [];
  for (const gid of groupOrder) {
    const tabs = groupBuckets.get(gid);
    if (!tabs || tabs.length < 2) {
      continue;
    }
    groups.push({
      groupId: gid,
      tabs: orderTabs(tabs.slice(0, maxPanes), allTabs),
    });
  }
  return groups;
}
