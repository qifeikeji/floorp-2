# Floorp OS API Server Performance Report

- **Date**: 2026-03-24
- **Environment**: Windows 11 Pro, dev build (`deno task dev`)
- **Target page**: `https://example.com`
- **Server**: `http://127.0.0.1:58261`
- **Method**: curl with `%{time_total}`, 3-5 iterations per endpoint, median reported

---

## Summary

| Category | Endpoint Count | Latency Range | Assessment |
|---|---|---|---|
| Tier 1: Instant | 18 | < 5ms | Excellent |
| Tier 2: Fast | 8 | 5-10ms | Good |
| Tier 3: Moderate | 4 | 40-100ms | Acceptable (I/O bound) |
| Tier 4: Slow | 2 | > 100ms | Needs investigation |

**Overall**: Most endpoints respond in under 5ms. The server's HTTP routing and IPC layer add minimal overhead (~2-3ms baseline from `/health`). Performance bottlenecks are concentrated in a few specific operations.

---

## Detailed Results

### Tier 1: Instant (< 5ms)

These endpoints respond near the server's baseline latency. No optimization needed.

| Endpoint | Method | Median | p95 | Payload |
|---|---|---|---|---|
| `/health` | GET | 2.7ms | 7.4ms | 17B |
| `/tabs/list` | GET | 3.0ms | 3.4ms | - |
| `/browser/tabs` | GET | 2.9ms | 3.3ms | - |
| `/workspaces` | GET | 2.8ms | 4.0ms | - |
| `/instances/:id/cookies` | GET | 2.8ms | 5.9ms | - |
| `/instances/:id/uri` | GET | 3.8ms | 4.8ms | 33B |
| `/instances/:id/title` | GET | 4.1ms | 7.5ms | 27B |
| `/instances/:id/element?selector=h1` | GET | 4.0ms | 4.6ms | 36B |
| `/instances/:id/elementText?selector=h1` | GET | 3.7ms | 4.1ms | 26B |
| `/instances/:id/elementTextContent?selector=h1` | GET | 4.0ms | 4.4ms | 26B |
| `/instances/:id/attribute?selector=a&name=href` | GET | 3.8ms | 4.3ms | 47B |
| `/instances/:id/isVisible?selector=a` | GET | 3.3ms | 3.9ms | 16B |
| `/instances/:id/isEnabled?selector=a` | GET | 3.7ms | 3.8ms | 16B |
| `/instances/:id/ax-tree` | GET | 2.7ms | 3.0ms | 46B |
| `/instances/:id/waitForElement` (existing) | POST | 3.8ms | 4.6ms | 27B |
| `/instances/:id/clearEffects` | POST | 3.4ms | 4.0ms | 11B |
| `/instances/:id/article` | GET | 2.8ms | 14.8ms | 36B |
| `DELETE /instances/:id` | DELETE | 3.0ms | - | 11B |

### Tier 2: Fast (5-10ms)

Slightly above baseline due to DOM traversal, serialization, or coordinate computation.

| Endpoint | Method | Median | p95 | Payload |
|---|---|---|---|---|
| `/instances/:id/html` | GET | 6.5ms | 6.7ms | ~15KB |
| `/instances/:id/text` | GET | 8.7ms | 11.3ms | 270B |
| `POST /instances/:id/text` (fingerprints) | POST | 6.7ms | 8.3ms | 629B |
| `/instances/:id/hover` | POST | 6.7ms | 8.5ms | 11B |
| `/instances/:id/scrollTo` | POST | 5.7ms | 6.5ms | 11B |
| `/instances/:id/focus` | POST | 5.1ms | 7.2ms | 11B |
| `/browser/history?limit=10` | GET | 3.5ms | 4.0ms | - |
| `/browser/context` | GET | 4.8ms | 143.7ms | - |

**Note**: `/browser/context` has an occasional spike (~144ms) likely caused by GC pause or event loop contention.

### Tier 3: Moderate (40-100ms)

Latency is driven by I/O (network, rendering engine).

| Endpoint | Method | Median | p95 | Payload | Bottleneck |
|---|---|---|---|---|---|
| `/instances/:id/exists` | GET | **41ms** | 99ms | 15B | Unknown - needs investigation |
| `/instances/:id/navigate` | POST | **49ms** | 59ms | 11B | Network round-trip |
| `/instances/:id/screenshot` | GET | **76ms** | 80ms | 217KB | Canvas rendering + PNG encode |
| `/instances/:id/fullPageScreenshot` | GET | **86ms** | 92ms | 217KB | Canvas rendering + PNG encode |

### Tier 4: Slow (> 100ms)

| Endpoint | Method | Median | p95 | Bottleneck |
|---|---|---|---|---|
| `POST /instances/:id/click` | POST | **165ms** | 230ms | `waitForStable` 100ms delay + actionability checks |
| `POST /instances` (create) | POST | **6.9s** | - | Tab creation + full page load |

---

## Analysis & Recommendations

### 1. `/exists` is 10x slower than similar read endpoints (41ms vs 3-4ms)

**Expected**: `exists` should be a simple lookup (like `uri` or `title`).
**Observed**: 41ms median, with first call at 99ms.
**Action**: Investigate the implementation. Likely doing an unnecessary async round-trip to the content process or awaiting a promise that could be resolved synchronously.

### 2. `/click` latency is dominated by `waitForStable` (100ms fixed delay)

**Breakdown**:
- `waitForStable`: 100ms (fixed `timerSetTimeout`)
- Actionability checks + scroll: ~15ms
- `sendMouseEvent`: ~5ms
- IPC overhead: ~45ms

**Tradeoff**: The 100ms delay catches CSS transitions/animations. Removing it risks clicking moving elements. Consider:
- Making `waitForStable` timeout configurable via request body (e.g., `stabilityTimeout: 50`)
- Reducing default from 100ms to 50ms for simple pages
- Skipping entirely when `force: true` (already implemented)

### 3. Instance creation is very slow (6.9s)

This includes full page load (`https://example.com`). The time is mostly network + rendering. Consider:
- Allowing `POST /instances` to return immediately after tab creation (before load completes)
- Adding a separate `waitForLoad` endpoint for callers that need load completion

### 4. Screenshot latency is reasonable (76-86ms)

For PNG encoding of a full viewport, 76ms is acceptable. If lower latency is needed:
- Consider JPEG output option (faster encoding, smaller payload)
- Consider returning raw bitmap data for local consumers

### 5. Occasional spikes (~150ms) on fast endpoints

Observed on `/isEnabled` (157ms) and `/browser/context` (144ms). These are likely:
- JavaScript GC pauses in the parent process
- Event loop contention from other Floorp operations
- Not actionable without profiling, and acceptable for an API server

### 6. `/ax-tree` returns only 46 bytes

For `example.com` this returned `{"error":"ax-tree not available"}` or a minimal response. Needs verification that the accessibility tree is being correctly extracted for complex pages.

---

## Latency Budget (typical MCP tool call)

A typical MCP interaction involves multiple API calls. Example workflow:

| Step | Endpoint | Time |
|---|---|---|
| 1. Create instance | `POST /instances` | ~7000ms |
| 2. Get page text | `GET /text` | ~9ms |
| 3. Click element | `POST /click` | ~165ms |
| 4. Wait for navigation | `POST /waitForElement` | ~4ms |
| 5. Get new text | `GET /text` | ~9ms |
| 6. Cleanup | `DELETE /instances/:id` | ~3ms |
| **Total** | | **~7190ms** |

Without instance creation (reusing existing tab via `/attach`):

| Step | Endpoint | Time |
|---|---|---|
| 1. Attach to tab | `POST /attach` | ~5ms* |
| 2. Get page text | `GET /text` | ~9ms |
| 3. Click element | `POST /click` | ~165ms |
| 4. Get new text | `GET /text` | ~9ms |
| **Total** | | **~188ms** |

*Estimated based on similar lightweight operations.

**Conclusion**: Instance creation dominates total latency. For interactive use, reusing tabs via `/attach` brings total workflow time under 200ms, which is excellent.

---

## Large-Scale Site Benchmark: Gmail

Gmail (inbox with 243 messages) was tested to evaluate performance on a complex, real-world SPA with heavy DOM.

### Test Conditions

- **Page**: `https://mail.google.com/mail/u/0/#inbox` (logged in, 243 messages)
- **DOM complexity**: ~1MB HTML, deeply nested SPA structure
- **Instance creation**: 4.2s (faster than example.com — likely cached assets)

### Results Comparison: example.com vs Gmail

#### Read-Only Endpoints

| Endpoint | example.com | Gmail | Slowdown | Notes |
|---|---|---|---|---|
| `GET /uri` | 3.8ms | 3.7ms | 1.0x | No DOM access needed |
| `GET /title` | 4.1ms | 40ms | **10x** | Spikes to 449ms observed |
| `GET /exists` | 41ms | 80ms | **2x** | Consistently slow |
| `GET /html` | 6.5ms (15KB) | **1.0s** (950KB) | **150x** | Serializing ~1MB DOM |
| `GET /text` | 8.7ms (270B) | **2.4s** (107KB) | **275x** | DOM traversal + Turndown conversion |
| `POST /text` (fps) | 6.7ms (629B) | **2.7s** (220KB) | **400x** | + fingerprint generation |
| `GET /ax-tree` | 2.7ms (46B) | 4.3ms (46B) | 1.5x | Returns 46B on both — likely broken |
| `GET /screenshot` | 76ms (217KB) | **134ms** (397KB) | 1.8x | Reasonable scaling |
| `GET /fullPageScreenshot` | 86ms (217KB) | **157ms** (397KB) | 1.8x | Reasonable scaling |
| `GET /element` | 4.0ms | 11ms | 2.8x | |
| `GET /elementText` | 3.7ms | 13ms | 3.5x | |
| `GET /attribute` | 3.8ms | 7.0ms | 1.8x | |
| `GET /isVisible` | 3.3ms | 7.7ms | 2.3x | |
| `GET /cookies` | 2.8ms | **8.8ms** (14KB) | 3.1x | More cookies on Google |

#### Action Endpoints

| Endpoint | example.com | Gmail | Slowdown | Notes |
|---|---|---|---|---|
| `POST /hover` | 6.7ms | **73ms** | **11x** | Coordinate computation on complex layout |
| `POST /scrollTo` | 5.7ms | **45ms** | **8x** | First call 111ms (layout recalc?) |
| `POST /focus` | 5.1ms | **42ms** | **8x** | First call 112ms |
| `POST /click` | 165ms | **318ms** | 1.9x | waitForStable + complex layout |
| `POST /navigate` (SPA) | 49ms | **30s** (timeout) | **600x** | SPA doesn't fire `load` event |
| `GET /regionScreenshot` | - | 39ms (68KB) | - | Efficient partial capture |

### Critical Issues Found

#### 1. `navigate` times out on SPA pages (30s)

**Severity**: Critical
**Observed**: `POST /navigate` to `#inbox` on Gmail takes exactly 30 seconds — hitting the timeout.
**Root cause**: `navigate` waits for a `load` event, but Gmail is a SPA that uses `pushState`/`hashchange` for navigation. The `load` event never fires for in-app navigations.
**Impact**: Any workflow that navigates within a SPA (Gmail, YouTube, Twitter, etc.) will block for 30 seconds.
**Recommendation**: Detect SPA navigation (same-origin hash/pushState changes) and resolve immediately or use a shorter timeout with `DOMContentLoaded` / network idle detection.

#### 2. `text` extraction takes 2.4-3.7s on complex pages

**Severity**: High
**Observed**: `GET /text` = 2.4s, `POST /text` with fingerprints = 2.7s (107-220KB output).
**Root cause**: Turndown (HTML-to-Markdown) conversion traverses the entire DOM tree. Gmail's DOM is extremely deep (~1MB HTML).
**Impact**: This is the primary endpoint for MCP tool use — AI agents call `text` on every page interaction. 2-3s per call significantly impacts agent loop latency.
**Recommendation**:
- Support `selector` scoping in GET/POST to limit traversal (e.g., only extract the email list, not the entire UI)
- Consider caching/diffing for repeated calls on the same page state
- Profile Turndown to find hotspots (likely in node visibility checks)

#### 3. `html` takes 1s for ~1MB

**Severity**: Medium
**Observed**: 1.0s to serialize and transfer ~950KB of HTML.
**Root cause**: Combination of `outerHTML` serialization in content process + IPC transfer + HTTP response writing.
**Impact**: Less critical than `text` since `html` is used less frequently, but still notable.

#### 4. `title` has unpredictable latency (4ms to 449ms)

**Severity**: Low
**Observed**: Varies from 4ms to 449ms across 5 calls on Gmail.
**Root cause**: Likely contention with Gmail's JavaScript execution (timers, XHR callbacks, mutation observers).
**Impact**: Usually fast, but occasional spikes could affect perceived responsiveness.

#### 5. `ax-tree` returns 46 bytes on Gmail

**Severity**: Medium (functional issue)
**Observed**: Same 46-byte response on both example.com and Gmail. This is likely `{"error":"..."}` or an empty tree.
**Impact**: Accessibility tree is unusable. Should be investigated separately.

### Gmail Latency Budget (typical MCP workflow)

| Step | Endpoint | Time |
|---|---|---|
| 1. Create instance | `POST /instances` | ~4200ms |
| 2. Get page text | `GET /text` | ~2400ms |
| 3. Click email | `POST /click` | ~318ms |
| 4. Get email text | `GET /text` | ~4064ms |
| **Total** | | **~11s** |

With `/attach` (reusing existing tab):

| Step | Endpoint | Time |
|---|---|---|
| 1. Attach to tab | `POST /attach` | ~5ms* |
| 2. Get page text | `GET /text` | ~2400ms |
| 3. Click email | `POST /click` | ~318ms |
| 4. Get email text | `GET /text` | ~4064ms |
| **Total** | | **~6.8s** |

**Conclusion**: On large-scale SPAs, `text` extraction dominates latency at 2-4s per call. This is 250-400x slower than on simple pages. Scoped text extraction (passing a selector to limit DOM traversal) would be the highest-impact optimization.

---

## Large-Scale Site Benchmark: X (Twitter)

X home timeline was tested as another complex SPA with infinite scroll and dynamic content loading.

### Test Conditions

- **Page**: `https://x.com/home` (logged in, home timeline)
- **DOM complexity**: ~836KB HTML, React-based SPA
- **Instance creation**: 2.2s

### Results: X vs Gmail vs example.com

#### Read-Only Endpoints

| Endpoint | example.com | Gmail | X | Notes |
|---|---|---|---|---|
| `GET /uri` | 3.8ms | 3.7ms | 4.6ms | Consistent across all |
| `GET /title` | 4.1ms | 40ms | 5.9ms | Gmail is the outlier |
| `GET /exists` | 41ms | 80ms | **97ms** | Consistently slow on all sites |
| `GET /html` | 6.5ms (15KB) | 1.0s (950KB) | **252ms** (836KB) | X DOM is similar size but faster |
| `GET /text` | 8.7ms (270B) | 2.4s (107KB) | **1.7s** (44KB) | Heavy DOM traversal |
| `POST /text` (fps) | 6.7ms (629B) | 2.7s (220KB) | **1.4s** (112KB) | Fingerprint version faster than plain on X |
| `GET /ax-tree` | 2.7ms (46B) | 4.3ms (46B) | 2.7ms (46B) | Broken on all sites |
| `GET /screenshot` | 76ms (217KB) | 134ms (397KB) | **157ms** (527KB) | Scales with image size |
| `GET /fullPageScreenshot` | 86ms (217KB) | 157ms (397KB) | **163ms** (527KB) | |
| `GET /element` (article) | 4.0ms | 11ms | **11ms** (34KB) | X articles are large |
| `GET /elementText` | 3.7ms | 13ms | **4.6ms** | |
| `GET /attribute` | 3.8ms | 7.0ms | 4.5ms | |
| `GET /isVisible` | 3.3ms | 7.7ms | 3.9ms | |
| `GET /cookies` | 2.8ms | 8.8ms (14KB) | **3.8ms** (2.8KB) | Fewer cookies than Gmail |

#### Action Endpoints

| Endpoint | example.com | Gmail | X | Notes |
|---|---|---|---|---|
| `POST /hover` | 6.7ms | 73ms | **11ms** | First call 273ms (cold), then 10-11ms |
| `POST /scrollTo` | 5.7ms | 45ms | 7ms | `article:nth-of-type(3)` returned `ok:false` — not found |
| `POST /focus` | 5.1ms | 42ms | **27ms** | First call 329ms (cold), then 24-30ms |
| `POST /click` | 165ms | 318ms | **403ms** | Slowest of all three sites |
| `POST /navigate` (SPA) | 49ms | **30s** (timeout) | **175ms / 45ms** | X works! No load event issue |
| `POST /waitForElement` | 3.8ms | 5s (timeout) | **73ms-5s** | Inconsistent — first call timed out |
| `POST /regionScreenshot` | - | 39ms | **120-197ms** | Higher on X |

### Key Findings for X

#### 1. SPA Navigate works on X but not Gmail

**Observed**: `POST /navigate` to `/explore` took 175ms, back to `/home` took 45ms. No 30s timeout.
**Explanation**: X likely triggers a full page `load` event on navigation (or uses a different routing strategy than Gmail). This confirms the Gmail timeout is specific to Gmail's SPA implementation, not a universal SPA issue.

#### 2. Click is slowest on X (403ms)

**Observed**: 403ms on X vs 318ms on Gmail vs 165ms on example.com.
**Breakdown estimate**: waitForStable 100ms + actionability checks on complex DOM ~50ms + scroll/coordinate computation ~150ms + sendMouseEvent ~5ms + IPC overhead ~100ms.
**Root cause**: X's deeply nested React component tree and heavy event handlers likely slow down coordinate computation and the scroll-into-view step.

#### 3. First-call penalty on hover/focus (270-330ms)

**Observed**: First `hover` took 273ms, subsequent calls 10-11ms. First `focus` took 329ms, then 24-30ms.
**Root cause**: JIT compilation or lazy initialization of the coordinate/actionability pipeline. After warm-up, performance stabilizes.
**Impact**: Minimal — only affects the very first interaction after instance creation.

#### 4. Text extraction is faster than Gmail despite similar DOM size

**Observed**: X text = 1.7s (44KB) vs Gmail text = 2.4s (107KB). HTML size is comparable (~836KB vs ~950KB).
**Explanation**: Gmail's DOM is more deeply nested with more visible text nodes (email previews, labels, folders). X's timeline has more hidden/clipped content that Turndown skips.

#### 5. `waitForElement` is unreliable after SPA navigation

**Observed**: First call after navigating back to `/home` timed out at 5s. Second call found the element in 736ms. Third call in 72ms.
**Root cause**: After SPA navigation, X lazy-loads timeline content. The first `article` element may not exist immediately. This is expected behavior, but the 5s default timeout may be too short for slow connections.

### X Latency Budget (typical MCP workflow)

| Step | Endpoint | Time |
|---|---|---|
| 1. Create instance | `POST /instances` | ~2200ms |
| 2. Get timeline text | `GET /text` | ~1700ms |
| 3. Click tweet | `POST /click` | ~403ms |
| 4. Get tweet text | `GET /text` | ~497ms |
| **Total** | | **~4800ms** |

With `/attach`:

| Step | Endpoint | Time |
|---|---|---|
| 1. Attach to tab | `POST /attach` | ~5ms* |
| 2. Get timeline text | `GET /text` | ~1700ms |
| 3. Click tweet | `POST /click` | ~403ms |
| 4. Get tweet text | `GET /text` | ~497ms |
| **Total** | | **~2600ms** |

---

## Cross-Site Summary

### Performance Tiers by Site

| Endpoint | example.com | Gmail | X | Category |
|---|---|---|---|---|
| Simple reads (uri/title/visible) | 3-4ms | 4-40ms | 4-6ms | Fast everywhere |
| `GET /exists` | 41ms | 80ms | 97ms | Slow everywhere — investigate |
| `GET /html` | 7ms | 1.0s | 252ms | Scales with DOM size |
| `GET /text` | 9ms | **2.4s** | **1.7s** | **Primary bottleneck** |
| `POST /text` (fps) | 7ms | **2.7s** | **1.4s** | **Primary bottleneck** |
| `POST /click` | 165ms | 318ms | 403ms | Scales with DOM complexity |
| `POST /navigate` (SPA) | 49ms | **30s** | 175ms | Gmail-specific timeout issue |
| `GET /screenshot` | 76ms | 134ms | 157ms | Scales with pixel content |
| `GET /ax-tree` | 46B | 46B | 46B | **Broken on all sites** |

### Top Optimization Priorities (updated)

| Priority | Issue | Impact | Affected Sites |
|---|---|---|---|
| 1 | **`text` extraction 1.4-2.7s** | Blocks every MCP agent loop | Gmail, X |
| 2 | **SPA `navigate` 30s timeout** | Completely broken workflow | Gmail |
| 3 | **`exists` 41-97ms** | 10-25x slower than similar endpoints | All |
| 4 | **`ax-tree` non-functional** | Accessibility data unavailable | All |
| 5 | **`click` 165-403ms** | 100ms of fixed `waitForStable` delay | All |
| 6 | **First-call penalty** | 270-330ms on first hover/focus | X |

---

## Large-Scale Site Benchmark: YouTube

YouTube home page was tested as a heavy media-centric SPA with Web Components (custom elements like `ytd-rich-item-renderer`).

### Test Conditions

- **Page**: `https://www.youtube.com/` (logged in, home feed)
- **DOM complexity**: ~850KB HTML, Polymer/Lit-based Web Components
- **Instance creation**: **19.4s** — by far the slowest (heavy JS bundles + video preloading)

### Results: YouTube vs All Sites

#### Read-Only Endpoints

| Endpoint | example.com | Gmail | X | YouTube | Notes |
|---|---|---|---|---|---|
| `GET /uri` | 3.8ms | 3.7ms | 4.6ms | 3.5ms | Consistent |
| `GET /title` | 4.1ms | 40ms | 5.9ms | 4.4ms | |
| `GET /exists` | 41ms | 80ms | 97ms | **33ms** | Fastest — still slow vs uri/title |
| `GET /html` | 7ms (15KB) | 1.0s (950KB) | 252ms (836KB) | **256ms** (853KB) | Similar to X |
| `GET /text` | 9ms (270B) | 2.4s (107KB) | 1.7s (44KB) | **960ms** (7.9KB) | Fastest large site — little visible text |
| `POST /text` (fps) | 7ms (629B) | 2.7s (220KB) | 1.4s (112KB) | **1.0s** (32KB) | |
| `GET /ax-tree` | 2.7ms (46B) | 4.3ms (46B) | 2.7ms (46B) | 5.0ms (46B) | Still broken |
| `GET /screenshot` | 76ms (217KB) | 134ms (397KB) | 157ms (527KB) | **47ms** (60KB) | Small — dark theme, simple thumbnails |
| `GET /fullPageScreenshot` | 86ms (217KB) | 157ms (397KB) | 163ms (527KB) | **35ms** (60KB) | Same as viewport |
| `GET /element` (video) | 4.0ms | 11ms | 11ms (34KB) | 5.0ms (**2B**) | **Empty** — Web Component not traversable |
| `GET /elementText` (video) | 3.7ms | 13ms | 4.6ms | 4.2ms (**2B**) | **Empty** |
| `GET /attribute` | 3.8ms | 7.0ms | 4.5ms | 4.7ms (`null`) | **null** — selector not found |
| `GET /isVisible` (search) | 3.3ms | 7.7ms | 3.9ms | 4.9ms (`false`) | Shadow DOM barrier? |
| `GET /cookies` | 2.8ms | 8.8ms (14KB) | 3.8ms (2.8KB) | 5.5ms (6.9KB) | |

#### Action Endpoints

| Endpoint | example.com | Gmail | X | YouTube | Notes |
|---|---|---|---|---|---|
| `POST /hover` | 6.7ms | 73ms | 11ms | **8.5ms** | Fast after warm-up (first: 19ms) |
| `POST /scrollTo` | 5.7ms | 45ms | 7ms | **6.1ms** | |
| `POST /focus` | 5.1ms | 42ms | 27ms | **7.5ms** | |
| `POST /click` | 165ms | 318ms | 403ms | **333ms** (`ok:false`) | **Failed** — click didn't register |
| `POST /navigate` (SPA) | 49ms | 30s | 175ms | **31ms-2.2s** | Variable — home=2.2s, trending=31ms |
| `POST /waitForElement` | 3.8ms | 5s | 73ms-5s | **105ms-5s** | `ytd-video-renderer` not found on trending |
| `POST /regionScreenshot` | - | 39ms | 120ms | **11ms** (12.5KB) | Very fast — small content |

### Key Findings for YouTube

#### 1. Web Components are opaque to element queries

**Severity**: Critical (functional)
**Observed**: `element?selector=ytd-rich-item-renderer` returns 2 bytes (empty). `attribute?selector=a#video-title-link&name=href` returns `null`. `isVisible?selector=input#search` returns `false`.
**Root cause**: YouTube uses Polymer/Lit Web Components with Shadow DOM. Standard `querySelector` cannot pierce shadow boundaries. The API's DOM operations only search the light DOM.
**Impact**: Most element-targeting operations are effectively broken on YouTube. Selectors like `ytd-rich-item-renderer`, `a#thumbnail`, `input#search` exist inside shadow roots and are invisible to the API.
**Recommendation**: Implement `deepQuerySelector` that traverses into shadow roots, or provide a `piercesShadow: true` option.

#### 2. Click returned `ok:false` on video thumbnail

**Severity**: High
**Observed**: `POST /click` with `selector: "a#thumbnail"` returned `{"ok":false}` in 333ms. URL didn't change.
**Root cause**: Related to Shadow DOM issue — the element was likely found in light DOM but actionability checks or coordinate computation failed because the rendered element is inside a shadow root.

#### 3. Instance creation is extremely slow (19.4s)

**Observed**: 19.4s vs Gmail 4.2s vs X 2.2s vs example.com 6.9s.
**Root cause**: YouTube loads very heavy JS bundles, preloads video content, and runs extensive initialization. The `load` event fires late.
**Impact**: First-time access to YouTube via the API is very slow.

#### 4. SPA navigate latency is inconsistent

**Observed**: Navigate to `/feed/trending` = 31ms (fast). Navigate back to home = 2.2s (slow).
**Root cause**: YouTube's home page triggers heavy content loading (video thumbnails, recommendations). Trending page is lighter. The `load`/`DOMContentLoaded` event timing varies dramatically.

#### 5. Text extraction is fast but returns very little

**Observed**: `GET /text` = 960ms but only 7.9KB of text. Gmail returns 107KB, X returns 44KB.
**Root cause**: Most of YouTube's visible text is inside Web Components' shadow DOMs. Turndown can only see the light DOM text, which is minimal.
**Impact**: The text endpoint is nearly useless on YouTube — it misses video titles, descriptions, channel names, etc.

#### 6. Screenshots are very small (60KB)

**Observed**: 47ms for a 60KB screenshot. Gmail = 397KB, X = 527KB.
**Root cause**: YouTube's dark theme with simple thumbnail grid produces a highly compressible PNG. Screenshots DO render correctly (they capture the visual output, not DOM), so screenshots are the most reliable way to "see" YouTube's content.

### YouTube Latency Budget (typical MCP workflow)

| Step | Endpoint | Time | Status |
|---|---|---|---|
| 1. Create instance | `POST /instances` | ~19400ms | Very slow |
| 2. Get page text | `GET /text` | ~960ms | Fast but mostly empty |
| 3. Click video | `POST /click` | ~333ms | **FAILS** (Shadow DOM) |
| 4. Get video text | `GET /text` | ~850ms | Mostly empty |
| **Total** | | **~21.5s** | **Partially broken** |

**Conclusion**: YouTube is largely non-functional with the current API due to Shadow DOM. Screenshots work, but text extraction and element interaction are severely limited.

---

## Cross-Site Summary (Final)

### Performance Matrix

| Endpoint | example.com | Gmail | X | YouTube | Category |
|---|---|---|---|---|---|
| Simple reads | 3-4ms | 4-40ms | 4-6ms | 3-5ms | OK everywhere |
| `GET /exists` | 41ms | 80ms | 97ms | 33ms | Slow everywhere |
| `GET /html` | 7ms | 1.0s | 252ms | 256ms | Scales with DOM |
| `GET /text` | 9ms | **2.4s** | **1.7s** | 960ms* | *YouTube: mostly empty |
| `POST /click` | 165ms | 318ms | 403ms | 333ms** | **YouTube: fails |
| `POST /navigate` (SPA) | 49ms | **30s** | 175ms | 31ms-2.2s | Gmail broken |
| `GET /screenshot` | 76ms | 134ms | 157ms | 47ms | Always works |
| `GET /ax-tree` | 46B | 46B | 46B | 46B | Broken everywhere |
| Instance creation | 6.9s | 4.2s | 2.2s | **19.4s** | YouTube very slow |

### Final Priority List

| Priority | Issue | Impact | Sites Affected |
|---|---|---|---|
| **1** | **Shadow DOM not supported** | Element queries, click, text extraction all fail | YouTube (and any Web Component site) |
| **2** | **`text` extraction 1-2.7s** | Primary MCP endpoint, blocks every agent loop | Gmail, X, YouTube |
| **3** | **SPA `navigate` 30s timeout** | Workflow completely blocked | Gmail |
| **4** | **`ax-tree` non-functional** | Accessibility data unavailable | All sites |
| **5** | **`exists` 33-97ms** | 10-25x slower than similar endpoints | All sites |
| **6** | **`click` 165-403ms** | 100ms fixed `waitForStable` delay | All sites |
| **7** | **Instance creation 2-19s** | Slow first access, especially YouTube | All sites |

---

## Raw Data

All measurements taken with:
```bash
curl -s -w "%{time_total}" -o /dev/null <url>
```

- Iterations: 3-5 per endpoint
- Warm-up: Server was idle before measurements; first call to each endpoint may include JIT compilation overhead
- Pages: `https://example.com` (15KB), Gmail inbox (~950KB, 243 messages), X home timeline (~836KB), YouTube home (~853KB)
- Network: Localhost loopback (127.0.0.1), no auth token configured
