/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { render } from "@nora/solid-xul";
import { createRootHMR } from "@nora/solid-xul";
import { createSignal } from "solid-js";
import { noraComponent, NoraComponentBase } from "#features-chrome/utils/base";
import { BrowserActionUtils } from "../../utils/browser-action.tsx";
import {
  ZenModeMenuElement,
  setZenModeEnabled,
  initZenModeState,
} from "./zen-mode.tsx";
import { StyleElement } from "./styleElem.tsx";
import { addI18nObserver } from "#i18n/config-browser-chrome.ts";
import i18next from "i18next";

@noraComponent(import.meta.hot)
export default class ZenMode extends NoraComponentBase {
  init() {
    this.logger.info("Initializing Zen Mode");

    if (typeof document === "undefined") {
      this.logger.warn("Document is unavailable; skip initializing Zen Mode.");
      return;
    }

    // Initialize state management and hover detection
    initZenModeState();

    const tryInit = () => {
      this.injectMenu();
      this.createToolbarButton();
    };

    if (document?.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tryInit, { once: true });
    } else {
      tryInit();
    }
  }

  private injectMenu() {
    const menuPopup = document!.getElementById("menu_ToolsPopup");
    if (!menuPopup) {
      this.logger.warn(
        "Failed to locate #menu_ToolsPopup; Zen Mode menu item will not be injected.",
      );
      return;
    }

    const marker = document!.getElementById("menu_openFirefoxView");

    try {
      render(ZenModeMenuElement, menuPopup, {
        marker: marker?.parentElement === menuPopup ? marker : undefined,
        hotCtx: import.meta.hot,
      });
      this.logger.info("Zen Mode menu item rendered successfully.");
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      this.logger.error("Failed to render Zen Mode menu item", reason);
    }
  }

  private createToolbarButton() {
    BrowserActionUtils.createToolbarClickActionButton(
      "zen-mode-button",
      null,
      () => setZenModeEnabled((prev) => !prev),
      StyleElement(),
      null,
      null,
      (aNode: XULElement) => {
        const tooltip = document!.createXULElement("tooltip") as XULElement;
        tooltip.id = "zen-mode-button-tooltip";
        tooltip.setAttribute("hasbeenopened", "false");
        document!.getElementById("mainPopupSet")?.appendChild(tooltip);
        aNode.setAttribute("tooltip", "zen-mode-button-tooltip");

        createRootHMR(
          () => {
            const [texts, setTexts] = createSignal({
              buttonLabel: "Zen Mode",
              tooltipText: "Toggle Zen Mode",
            });

            aNode.setAttribute("label", texts().buttonLabel);
            tooltip.setAttribute("label", texts().tooltipText);

            addI18nObserver(() => {
              setTexts({
                buttonLabel: i18next.t("zen-mode.label", {
                  defaultValue: "Zen Mode",
                }),
                tooltipText: i18next.t("zen-mode.tooltiptext", {
                  defaultValue: "Toggle Zen Mode",
                }),
              });
              aNode.setAttribute("label", texts().buttonLabel);
              tooltip.setAttribute("label", texts().tooltipText);
            });
          },
          import.meta.hot,
        );
      },
    );
  }
}
