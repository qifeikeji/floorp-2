// SPDX-License-Identifier: MPL-2.0
// @colocated-env browser

import {
  assert,
  assertEquals,
  runTests,
  type TestCase,
} from "../../../../test/utils/test_harness.ts";
import {
  destroyTabDrop,
  initTabDrop,
  isTabDragToSplitCreationEnabled,
} from "../split-view-tab-drop.ts";
import type {
  SplitViewGBrowser,
  SplitViewTab,
  SplitViewWrapper,
} from "../../data/types.ts";

const TAB_DROP_TYPE = "application/x-moz-tabbrowser-tab";
const NEW_WINDOW_ZONE_ID = "floorp-new-window-drop-zone";
const PREF_SPLIT_VIEW_DND_CREATION_ENABLED =
  "floorp.splitView.dragToSplitCreate.enabled";

type TestTab = SplitViewTab & { _lastAccessed?: number };

interface DragScenario {
  addTabSplitViewCalls: () => number;
  cleanup: () => void;
  dispatchDragToContent: () => { drop: Event };
  tabpanels: HTMLElement;
}

const testLogger = {
  debug() {},
  warn() {},
  error() {},
} as ConsoleInstance;

function withRestoredPref(run: () => void): void {
  const hadUserValue = Services.prefs.prefHasUserValue(
    PREF_SPLIT_VIEW_DND_CREATION_ENABLED,
  );
  const originalValue = Services.prefs.getBoolPref(
    PREF_SPLIT_VIEW_DND_CREATION_ENABLED,
    true,
  );

  try {
    run();
  } finally {
    if (hadUserValue) {
      Services.prefs.setBoolPref(
        PREF_SPLIT_VIEW_DND_CREATION_ENABLED,
        originalValue,
      );
    } else if (
      Services.prefs.prefHasUserValue(PREF_SPLIT_VIEW_DND_CREATION_ENABLED)
    ) {
      Services.prefs.clearUserPref(PREF_SPLIT_VIEW_DND_CREATION_ENABLED);
    }
  }
}

function createTestTab(label: string, lastAccessed: number): TestTab {
  return {
    linkedBrowser: document.createElement("browser") as unknown as XULElement,
    linkedPanel: `${label}-panel`,
    splitview: null,
    selected: false,
    label,
    _lastAccessed: lastAccessed,
  };
}

function createTabDragEvent(
  type: string,
  clientX = 100,
  clientY = 50,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = {
    types: [TAB_DROP_TYPE],
    dropEffect: "none",
  };

  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer,
    configurable: true,
  });
  Object.defineProperty(event, "clientX", {
    value: clientX,
    configurable: true,
  });
  Object.defineProperty(event, "clientY", {
    value: clientY,
    configurable: true,
  });

  return event;
}

function setGlobalGBrowser(value: SplitViewGBrowser): () => void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "gBrowser",
  );

  Object.defineProperty(globalThis, "gBrowser", {
    value,
    configurable: true,
  });

  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "gBrowser", originalDescriptor);
      return;
    }

    delete (globalThis as Record<string, unknown>).gBrowser;
  };
}

function ensureTabpanels(): {
  element: HTMLElement;
  cleanup: () => void;
} {
  const existing = document.getElementById("tabbrowser-tabpanels");
  const element = existing ?? document.createElement("div");
  const created = existing === null;

  if (created) {
    element.id = "tabbrowser-tabpanels";
    document.documentElement.appendChild(element);
  }

  const originalRect = Object.getOwnPropertyDescriptor(
    element,
    "getBoundingClientRect",
  );
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    configurable: true,
  });

  return {
    element,
    cleanup: () => {
      element.removeAttribute("data-floorp-tab-dragging");
      element.removeAttribute("split-view-layout");
      if (originalRect) {
        Object.defineProperty(element, "getBoundingClientRect", originalRect);
      } else {
        delete (element as unknown as Record<string, unknown>)
          .getBoundingClientRect;
      }
      if (created) {
        element.remove();
      }
    },
  };
}

function setupDragScenario(): DragScenario {
  destroyTabDrop();

  const { element: tabpanels, cleanup: cleanupTabpanels } = ensureTabpanels();
  const tabContainer = document.createElement("div") as HTMLElement & {
    linkedTab?: TestTab;
  };
  const draggedTab = createTestTab("dragged", 1);
  const partnerTab = createTestTab("partner", 10);
  let addTabSplitViewCalls = 0;

  tabContainer.linkedTab = draggedTab;

  const wrapper: SplitViewWrapper = {
    tabs: [partnerTab, draggedTab],
    addTabs() {},
    reverseTabs() {},
    unsplitTabs() {},
  };

  const mockGBrowser: SplitViewGBrowser = {
    tabpanels: tabpanels as unknown as SplitViewGBrowser["tabpanels"],
    tabContainer: tabContainer as unknown as XULElement,
    tabs: [partnerTab, draggedTab],
    selectedTab: partnerTab,
    selectedTabs: [],
    activeSplitView: null,
    showSplitViewPanels() {},
    moveTabBefore() {},
    moveTabToSplitView() {},
    addTrustedTab() {
      return createTestTab("trusted", 20);
    },
    addTabSplitView() {
      addTabSplitViewCalls += 1;
      return wrapper;
    },
    replaceTabWithWindow() {},
  };

  const cleanupGBrowser = setGlobalGBrowser(mockGBrowser);
  initTabDrop(testLogger);

  return {
    addTabSplitViewCalls: () => addTabSplitViewCalls,
    tabpanels,
    dispatchDragToContent: () => {
      tabContainer.dispatchEvent(createTabDragEvent("dragstart"));
      document.dispatchEvent(createTabDragEvent("dragover"));
      const drop = createTabDragEvent("drop");
      document.dispatchEvent(drop);
      document.dispatchEvent(new Event("dragend", { bubbles: true }));
      return { drop };
    },
    cleanup: () => {
      destroyTabDrop();
      cleanupGBrowser();
      cleanupTabpanels();
      document.getElementById(NEW_WINDOW_ZONE_ID)?.remove();
    },
  };
}

function testTabDragToSplitCreationDefaultsToEnabled(): void {
  withRestoredPref(() => {
    if (
      Services.prefs.prefHasUserValue(PREF_SPLIT_VIEW_DND_CREATION_ENABLED)
    ) {
      Services.prefs.clearUserPref(PREF_SPLIT_VIEW_DND_CREATION_ENABLED);
    }

    assertEquals(
      isTabDragToSplitCreationEnabled(),
      true,
      "tab drag-to-split creation should default to enabled",
    );
  });
}

function testTabDragToSplitCreationCanBeDisabled(): void {
  withRestoredPref(() => {
    Services.prefs.setBoolPref(PREF_SPLIT_VIEW_DND_CREATION_ENABLED, false);

    assertEquals(
      isTabDragToSplitCreationEnabled(),
      false,
      "tab drag-to-split creation should be disabled when the pref is false",
    );
  });
}

function testTabDragToSplitCreationCanBeEnabled(): void {
  withRestoredPref(() => {
    Services.prefs.setBoolPref(PREF_SPLIT_VIEW_DND_CREATION_ENABLED, true);

    assertEquals(
      isTabDragToSplitCreationEnabled(),
      true,
      "tab drag-to-split creation should be enabled when the pref is true",
    );
  });
}

function testDisabledPrefPreventsDragDropSplitCreation(): void {
  withRestoredPref(() => {
    Services.prefs.setBoolPref(PREF_SPLIT_VIEW_DND_CREATION_ENABLED, false);
    const scenario = setupDragScenario();

    try {
      const { drop } = scenario.dispatchDragToContent();

      assertEquals(
        scenario.addTabSplitViewCalls(),
        0,
        "disabled pref should prevent drag-and-drop split view creation",
      );
      assertEquals(
        drop.defaultPrevented,
        false,
        "disabled pref should not claim the content drop target",
      );
      assert(
        !scenario.tabpanels.hasAttribute("data-floorp-tab-dragging"),
        "disabled pref should not leave tab dragging state on tabpanels",
      );
      assertEquals(
        document.getElementById(NEW_WINDOW_ZONE_ID),
        null,
        "disabled pref should not create the new-window drop zone",
      );
    } finally {
      scenario.cleanup();
    }
  });
}

function testEnabledPrefAllowsDragDropSplitCreation(): void {
  withRestoredPref(() => {
    Services.prefs.setBoolPref(PREF_SPLIT_VIEW_DND_CREATION_ENABLED, true);
    const scenario = setupDragScenario();

    try {
      const { drop } = scenario.dispatchDragToContent();

      assertEquals(
        scenario.addTabSplitViewCalls(),
        1,
        "enabled pref should allow drag-and-drop split view creation",
      );
      assertEquals(
        drop.defaultPrevented,
        true,
        "enabled pref should claim the content drop target",
      );
    } finally {
      scenario.cleanup();
    }
  });
}

export async function runAllTests(): Promise<void> {
  const tests: TestCase[] = [
    {
      name: "tab drag-to-split creation defaults to enabled",
      fn: testTabDragToSplitCreationDefaultsToEnabled,
    },
    {
      name: "tab drag-to-split creation can be disabled",
      fn: testTabDragToSplitCreationCanBeDisabled,
    },
    {
      name: "tab drag-to-split creation can be enabled",
      fn: testTabDragToSplitCreationCanBeEnabled,
    },
    {
      name: "disabled pref prevents drag-and-drop split view creation",
      fn: testDisabledPrefPreventsDragDropSplitCreation,
    },
    {
      name: "enabled pref allows drag-and-drop split view creation",
      fn: testEnabledPrefAllowsDragDropSplitCreation,
    },
  ];

  await runTests("split-view-tab-drop.test.ts", tests);
}
