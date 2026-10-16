import test from "node:test";
import assert from "node:assert/strict";
import { makeSession, seal, unseal } from "../dist/assets/storage.js";
import { emptyBook } from "../dist/assets/model.js";
import { makeServer } from "../scripts/serve.mjs";
test("AES-GCM 加密往返；口令和修改后的密文不可解锁", async () => {
  const b = emptyBook();
  b.name = "仅此测试的私密名称";
  const session = await makeSession("testing-long-passphrase");
  const encrypted = await seal(b, session);
  assert.ok(!encrypted.includes(b.name));
  assert.ok(!encrypted.includes("testing-long-passphrase"));
  const restored = await unseal(encrypted, "testing-long-passphrase");
  assert.deepEqual(restored.book, b);
  await assert.rejects(unseal(encrypted, "wrong-password"), /口令/);
  const modified = JSON.parse(encrypted);
  modified.ciphertext =
    (modified.ciphertext[0] === "A" ? "B" : "A") + modified.ciphertext.slice(1);
  await assert.rejects(
    unseal(JSON.stringify(modified), "testing-long-passphrase"),
    /损坏/,
  );
});
test("服务端身份认证保护静态页及资源，路径不能逃逸 dist", async () => {
  const server = makeServer({
    credentials: { username: "fixture", password: "fixture-password-only" },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    let r = await fetch(url);
    assert.equal(r.status, 401);
    assert.ok(r.headers.get("www-authenticate"));
    r = await fetch(url + "/assets/app.js");
    assert.equal(r.status, 401);
    const headers = {
      Authorization:
        "Basic " +
        Buffer.from("fixture:fixture-password-only").toString("base64"),
    };
    r = await fetch(url + "/preview/", { headers });
    assert.equal(r.status, 200);
    assert.ok((await r.text()).includes("拾账"));
    r = await fetch(url + "/preview/assets/app.js", { headers });
    assert.equal(r.status, 200);
    assert.ok(
      r.headers.get("content-security-policy").includes("script-src 'self'"),
    );
    r = await fetch(url + "/%2e%2e%2fpackage.json", { headers });
    assert.notEqual(r.status, 200);
    r = await fetch(url + "/index.html", { method: "POST", headers });
    assert.equal(r.status, 405);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
