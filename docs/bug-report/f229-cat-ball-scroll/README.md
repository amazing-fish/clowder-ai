# F229 Cat Ball scroll browser evidence

Source revision: `1fbdad6d635282d97b7fa706fb9056b5789c15c5` (PR #1546, before adding these artifact files).

Run: `node --test packages/web/test/browser/f229-cat-ball-scroll-evidence.test.mjs` with a Playwright module available through `F229_PLAYWRIGHT_MODULE` when the public checkout does not contain `packages/ppt-forge`. The test starts its own Next dev server on an available localhost port, uses headless Chromium, and stops the server afterward. It uses synthetic thread/message data and intercepts API requests; no user data or live OpenCode invocation is involved.

The fixture mounts the real full `ThreadChatSurface` for selected thread A and the AppShell's real `ConciergePanel` for background thread B. The test checks:

1. [Before jump](artifacts/01-before-jump.png): B is scrolled upward and its `到最新` button is visible while A is at `scrollTop=220`.
2. [After jump](artifacts/02-after-jump.png): clicking B's button brings B within 120px of its bottom; A remains at 220.
3. [After append](artifacts/03-after-append.png): a new B message appears at the bottom and B follows it; A remains at 220.
4. [After full remount](artifacts/04-full-remount-restored.png): after unmounting and remounting A, its `scrollTop` is restored to 220.

The exact source-revision run passed 1/1 Chromium test. API workspace behavior is covered separately by `packages/api/test/invoke-single-cat.test.js`; this browser fixture does not claim to validate the OpenCode provider.
