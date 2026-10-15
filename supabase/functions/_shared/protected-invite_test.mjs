import test from "node:test";
import assert from "node:assert/strict";
import { createProtectedInviteHandler } from "./protected-invite.mjs";

const receiptHash = "a".repeat(64);
const inviteDetails = { message: "Protected invitation", details: ["Private details"], dressCode: "Formal" };

function makeHandler(status, options = {}) {
  const calls = { checked: [], imageReads: 0 };
  const handler = createProtectedInviteHandler({
    checkStatus: async hash => {
      calls.checked.push(hash);
      if (options.checkError) throw options.checkError;
      return status;
    },
    readImage: async () => {
      calls.imageReads++;
      if (options.imageError) throw options.imageError;
      return new Uint8Array([137, 80, 78, 71]);
    },
    inviteDetails
  });
  return { handler, calls };
}

const request = (url = "https://function.invalid/protected-invite", hash = receiptHash) => new Request(url, {
  headers: hash === null ? {} : { Authorization: `Bearer ${hash}` }
});

test("OPTIONS supports browser preflight without querying guest status", async () => {
  const { handler, calls } = makeHandler("approved");
  const response = await handler(new Request("https://function.invalid/protected-invite", { method: "OPTIONS" }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.deepEqual(calls.checked, []);
});

test("missing and malformed receipts cannot retrieve invitation content or image", async () => {
  const { handler, calls } = makeHandler("approved");
  for (const hash of [null, "not-a-receipt", "g".repeat(64)]) {
    const text = await handler(request("https://function.invalid/protected-invite", hash));
    const image = await handler(request("https://function.invalid/protected-invite?asset=invite.png", hash));
    assert.equal(text.status, 401);
    assert.equal(image.status, 401);
  }
  assert.deepEqual(calls.checked, []);
  assert.equal(calls.imageReads, 0);
});

test("unknown, pending, rejected, and revoked requests cannot retrieve text or image", async () => {
  for (const state of ["unknown", "pending", "rejected", "revoked"]) {
    const options = state === "unknown" ? { checkError: Object.assign(new Error("not found"), { code: "P0002" }) } : {};
    const { handler, calls } = makeHandler(state === "unknown" ? null : state, options);
    for (const url of ["https://function.invalid/protected-invite", "https://function.invalid/protected-invite?asset=invite.png"]) {
      const response = await handler(request(url));
      assert.equal(response.status, 403);
      assert.equal(await response.text().then(body => body.includes("Protected invitation")), false);
    }
    assert.equal(calls.checked.length, 2);
    assert.equal(calls.imageReads, 0);
  }
});

test("approval is checked again for each resource so a revoked receipt cannot fetch the image", async () => {
  let checks = 0;
  let imageReads = 0;
  const handler = createProtectedInviteHandler({
    checkStatus: async () => (++checks === 1 ? "approved" : "revoked"),
    readImage: async () => { imageReads++; return new Uint8Array([1]); },
    inviteDetails
  });
  const text = await handler(request());
  const image = await handler(request("https://function.invalid/protected-invite?asset=invite.png"));
  assert.equal(text.status, 200);
  assert.equal(image.status, 403);
  assert.equal(checks, 2);
  assert.equal(imageReads, 0);
});

test("a stalled approval lookup returns a safe timeout response instead of hanging", async () => {
  const handler = createProtectedInviteHandler({
    checkStatus: () => new Promise(() => {}),
    readImage: async () => new Uint8Array(),
    inviteDetails,
    timeoutMs: 10
  });
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Invitation access could not be verified" });
});

test("approved receipt can retrieve invitation details and private image", async () => {
  const { handler, calls } = makeHandler("approved");
  const textResponse = await handler(request());
  assert.equal(textResponse.status, 200);
  assert.equal(textResponse.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await textResponse.json(), inviteDetails);

  const imageResponse = await handler(request("https://function.invalid/protected-invite?asset=invite.png"));
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get("Content-Type"), "image/png");
  assert.deepEqual([...new Uint8Array(await imageResponse.arrayBuffer())], [137, 80, 78, 71]);
  assert.equal(calls.checked.length, 2);
  assert.equal(calls.imageReads, 1);
  assert.ok(calls.checked.every(hash => hash === receiptHash));
});

test("database and image failures deny access without leaking error details", async () => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    const { handler: dbHandler } = makeHandler(null, { checkError: Object.assign(new Error(receiptHash), { code: "XX000" }) });
    const dbResponse = await dbHandler(request());
    assert.equal(dbResponse.status, 503);
    assert.equal((await dbResponse.text()).includes(receiptHash), false);

    const { handler: imageHandler } = makeHandler("approved", { imageError: new Error(receiptHash) });
    const imageResponse = await imageHandler(request("https://function.invalid/protected-invite?asset=invite.png"));
    assert.equal(imageResponse.status, 503);
    assert.equal((await imageResponse.text()).includes(receiptHash), false);
    assert.equal(JSON.stringify(logs).includes(receiptHash), false);
    assert.deepEqual(logs.map(entry => entry[1].stage), ["check_approval", "load_invite_asset"]);
  } finally {
    console.error = originalError;
  }
});
