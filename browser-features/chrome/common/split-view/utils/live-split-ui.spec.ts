/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { hasLiveSplitPanelsState } from "./live-split-ui.ts";

assert.equal(hasLiveSplitPanelsState(4, true), true);
assert.equal(hasLiveSplitPanelsState(2, true), true);
assert.equal(hasLiveSplitPanelsState(4, false), false);
assert.equal(hasLiveSplitPanelsState(1, true), false);

console.log("live-split-ui.spec: ok");
