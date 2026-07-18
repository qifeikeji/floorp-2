/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Shared HTTP request tracker for monitoring network idle state.
 *
 * This module provides a singleton HTTP tracker that monitors all HTTP requests
 * across browser instances, enabling accurate network idle detection for both
 * TabManager and WebScraper services.
 *
 * Usage:
 *   import { GlobalHTTPTracker, AutomationConstants } from "./http-tracker.sys.mts";
 *   GlobalHTTPTracker.init();
 *   const activeCount = GlobalHTTPTracker.getActiveCount(browsingContextId);
 */

/**
 * Constants for browser automation timing and behavior.
 * Centralized to ensure consistency across TabManager and WebScraper.
 */
export const AutomationConstants = {
  /** Default delay after user-visible actions (ms) */
  DEFAULT_ACTION_DELAY_MS: 500,

  /** Delay after form interactions (ms) - longer for UI feedback */
  FORM_ACTION_DELAY_MS: 3500,

  /** Delay after hover actions (ms) */
  HOVER_DELAY_MS: 2000,

  /** Delay after scroll actions (ms) */
  SCROLL_DELAY_MS: 1000,

  /** Delay after focus actions (ms) */
  FOCUS_DELAY_MS: 1000,

  /** Delay after key press (ms) */
  KEY_PRESS_DELAY_MS: 500,

  /** Max retries for actor availability */
  ACTOR_MAX_RETRIES: 150,

  /** Delay between actor retries (ms) */
  ACTOR_RETRY_DELAY_MS: 100,

  /** Default timeout for page load (ms) */
  PAGE_LOAD_TIMEOUT_MS: 30000,

  /** Default timeout for element wait (ms) */
  ELEMENT_WAIT_TIMEOUT_MS: 5000,

  /** Default timeout for document ready (ms) */
  DOCUMENT_READY_TIMEOUT_MS: 15000,

  /** Default timeout for network idle (ms) */
  NETWORK_IDLE_TIMEOUT_MS: 5000,

  /** Idle threshold for network idle detection (ms) */
  NETWORK_IDLE_THRESHOLD_MS: 500,
} as const;

/**
 * Global HTTP request tracker to accurately monitor network idle state.
 * This tracker lives for the lifetime of the module and monitors all instances.
 *
 * Singleton pattern ensures only one tracker exists across TabManager and WebScraper.
 */
export const GlobalHTTPTracker = {
  activeRequests: new Map<number, Set<nsIRequest>>(),
  _initialized: false,

  /**
   * Initialize the HTTP observer. Safe to call multiple times.
   */
  init() {
    if (this._initialized) return;
    try {
      Services.obs.addObserver(this, "http-on-opening-request");
      Services.obs.addObserver(this, "http-on-stop-request");
      this._initialized = true;
    } catch (e) {
      console.error("GlobalHTTPTracker init failed:", e);
    }
  },

  observe(subject: nsISupports, topic: string, _data: string | null) {
    try {
      // deno-lint-ignore no-explicit-any
      const channel = (subject as any).QueryInterface(Ci.nsIHttpChannel);
      const bcid = channel.loadInfo?.browsingContextID;
      if (!bcid) return;

      if (topic === "http-on-opening-request") {
        const url = channel.URI.spec;
        if (url.startsWith("http") || url.startsWith("https")) {
          let requests = this.activeRequests.get(bcid);
          if (!requests) {
            requests = new Set();
            this.activeRequests.set(bcid, requests);
          }
          requests.add(channel);
        }
      } else if (topic === "http-on-stop-request") {
        const requests = this.activeRequests.get(bcid);
        if (requests) {
          requests.delete(channel);
          if (requests.size === 0) {
            this.activeRequests.delete(bcid);
          }
        }
      }
    } catch {
      // Ignore non-HTTP channels and other errors
    }
  },

  /**
   * Get the count of active requests for a browsing context.
   * @param bcid - Browsing context ID
   * @returns Number of active HTTP requests
   */
  getActiveCount(bcid: number): number {
    return this.activeRequests.get(bcid)?.size || 0;
  },

  /**
   * Clear all tracked requests for a browsing context.
   * Call this when a tab/instance is closed.
   * @param bcid - Browsing context ID
   */
  clearForContext(bcid: number): void {
    this.activeRequests.delete(bcid);
  },

  /**
   * Check if the tracker has been initialized.
   */
  isInitialized(): boolean {
    return this._initialized;
  },
};
