import { assertBook } from "./validate.js";
export const VAULT_KEY = "shizhang.vault.v1";
export const PREVIOUS_KEY = "shizhang.previous.v1";
const encode = (bytes) => {
    let s = "";
    for (const b of bytes)
        s += String.fromCharCode(b);
    return btoa(s);
};
const decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ITERATIONS = 310000;
async function derive(password, salt, iterations = ITERATIONS) {
    if (!crypto.subtle)
        throw new Error("加密需要 HTTPS 或 localhost，请使用本地预览命令打开");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function makeSession(password) {
    if (password.length < 10)
        throw new Error("账本口令至少 10 个字符，请使用独立的长口令");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return {
        key: await derive(password, salt),
        salt: encode(salt),
        previous: null,
    };
}
export async function seal(book, session) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, session.key, new TextEncoder().encode(JSON.stringify(book)));
    const envelope = {
        format: "shizhang-vault",
        version: 1,
        kdf: "PBKDF2-SHA256",
        iterations: ITERATIONS,
        salt: session.salt,
        iv: encode(iv),
        ciphertext: encode(new Uint8Array(ciphertext)),
        savedAt: new Date().toISOString(),
    };
    return JSON.stringify(envelope);
}
export async function unseal(raw, password) {
    if (raw.length > 20_000_000)
        throw new Error("备份超过 20 MB，请拆分 CSV 或使用较小备份");
    const e = JSON.parse(raw);
    if (e.format !== "shizhang-vault" ||
        e.version !== 1 ||
        e.kdf !== "PBKDF2-SHA256" ||
        e.iterations !== ITERATIONS ||
        typeof e.salt !== "string" ||
        typeof e.iv !== "string" ||
        typeof e.ciphertext !== "string")
        throw new Error("不是支持的加密账本备份");
    const salt = decode(e.salt), iv = decode(e.iv);
    if (salt.length !== 16 || iv.length !== 12)
        throw new Error("备份参数损坏");
    const key = await derive(password, salt, e.iterations);
    let plain;
    try {
        plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, decode(e.ciphertext));
    }
    catch {
        throw new Error("口令不正确或备份已损坏，请核对后重试");
    }
    const book = JSON.parse(new TextDecoder().decode(plain));
    assertBook(book);
    return { book, session: { key, salt: e.salt, previous: raw } };
}
export async function saveVault(book, session) {
    const encoded = await seal(book, session);
    const write = () => {
        if (localStorage.getItem(VAULT_KEY) !== session.previous)
            throw new Error(session.previous === null
                ? "本机账本已在另一个标签页创建。请刷新页面并解锁已有账本。"
                : "账本已在另一个标签页更改。请锁定并重新解锁，再重试本次操作。");
        try {
            if (session.previous)
                localStorage.setItem(PREVIOUS_KEY, session.previous);
            localStorage.setItem(VAULT_KEY, encoded);
        }
        catch {
            throw new Error("本机空间不足或浏览器禁止保存。本次未保存，请先导出备份并腾出空间。");
        }
        session.previous = encoded;
    };
    if (navigator.locks)
        await navigator.locks.request("shizhang-save", write);
    else
        write();
}
