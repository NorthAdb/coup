import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionStore } from "./sessionAuth.js";

/** 公网部署防内存泄漏：匿名会话总量有上限，超限按创建序驱逐（FIFO）。 */
describe("session store cap", () => {
  it("evicts the oldest sessions beyond the cap", () => {
    const store = createSessionStore(3);
    const first = store.create();
    const second = store.create();
    const third = store.create();
    store.create();
    assert.equal(store.get(first.id), null);
    assert.ok(store.get(second.id));
    assert.ok(store.get(third.id));
  });

  it("keeps issuing and serving sessions under the cap", () => {
    const store = createSessionStore(4);
    const session = store.create();
    assert.equal(store.get(session.id)?.csrfToken, session.csrfToken);
    for (let i = 0; i < 3; i += 1) store.create();
    assert.ok(store.get(session.id));
  });
});
