import test from "node:test";
import assert from "node:assert/strict";
import { emptyBook, base } from "../dist/assets/model.js";
import { calculate } from "../dist/assets/engine.js";
import { dec } from "../dist/assets/decimal.js";
import { exportCSV, parseCSV, autoMapping, previewCSV } from "../dist/assets/csv.js";

const deposit = (id) => ({
  ...base("2026-01-01"), id, kind: "cash", direction: "in", fiat: "CNY",
  fiatAmount: "7000", usdAmount: "1000", rate: "7", fee: "0",
  payment: "USD", paymentAmount: "1000",
});
function preview(text, book = emptyBook()) {
  const rows = parseCSV(text);
  return previewCSV(rows, autoMapping(rows[0]), book);
}
const header = "流水ID,类型,日期,出入金方向,法币类型,法币金额,对应USD金额";
const row = (id = "", amount = "1000") =>
  `${id},出入金,2026-01-01,in,CNY,${Number(amount) * 7},${amount}`;

test("CSV: different explicit IDs preserve identical deposits in a fresh ledger and on reimport", () => {
  const original = emptyBook();
  original.entries = [deposit("deposit-a"), deposit("deposit-b")];
  const exported = exportCSV(original);
  const first = preview(exported);
  assert.deepEqual(first.errors, []);
  assert.equal(first.added, 2);
  assert.equal(first.duplicates, 0);
  assert.deepEqual(first.book.entries, original.entries);
  assert.equal(calculate(first.book).holdings.USD.qty, dec("2000"));
  assert.equal(calculate(first.book).netDeposit, dec("2000"));
  const again = preview(exported, first.book);
  assert.deepEqual(again.errors, []);
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, 2);
  assert.deepEqual(again.book.entries, original.entries);
});

test("CSV: a new explicit ID bypasses content matching against existing entries", () => {
  const book = emptyBook();
  book.entries = [deposit("existing")];
  const result = preview(`${header}\n${row("another")}`, book);
  assert.deepEqual(result.errors, []);
  assert.equal(result.added, 1);
  assert.equal(result.book.entries.length, 2);
  assert.equal(calculate(result.book).netDeposit, dec("2000"));
  assert.equal(book.entries.length, 1, "preview must not mutate the current book");
});

test("CSV: same ID is deduplicated within a batch and against the saved ledger", () => {
  const text = `${header}\n${row("same")}\n${row("same")}`;
  const first = preview(text);
  assert.deepEqual(first.errors, []);
  assert.equal(first.added, 1);
  assert.equal(first.duplicates, 1);
  const again = preview(text, first.book);
  assert.deepEqual(again.errors, []);
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, 2);
});

test("CSV: conflicting content under one ID remains an error in a batch or later import", () => {
  const first = preview(`${header}\n${row("same")}`);
  const conflict = row("same", "2000");
  for (const result of [
    preview(`${header}\n${row("same")}\n${conflict}`),
    preview(`${header}\n${conflict}`, first.book),
  ]) {
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /流水ID已存在但内容不同/);
    assert.equal(calculate(result.book).holdings.USD.qty, dec("1000"));
  }
});

test("CSV: absent or unmapped IDs still use content deduplication", () => {
  const text = `${header}\n${row()}\n${row()}`;
  const first = preview(text);
  assert.deepEqual(first.errors, []);
  assert.equal(first.added, 1);
  assert.equal(first.duplicates, 1);
  const again = preview(text, first.book);
  assert.deepEqual(again.errors, []);
  assert.equal(again.added, 0);
  assert.equal(again.duplicates, 2);
  const rows = parseCSV(`${header}\n${row("a")}\n${row("b")}`);
  const mapping = autoMapping(rows[0]);
  delete mapping.id;
  const unmapped = previewCSV(rows, mapping, emptyBook());
  assert.deepEqual(unmapped.errors, []);
  assert.equal(unmapped.added, 1);
  assert.equal(unmapped.duplicates, 1);
});

test("CSV: mixed rows respect explicit identity while anonymous rows compare all known contents", () => {
  const first = preview(`${header}\n${row()}\n${row("explicit")}\n${row()}`);
  assert.deepEqual(first.errors, []);
  assert.equal(first.added, 2);
  assert.equal(first.duplicates, 1);
  const second = preview(`${header}\n${row("other")}\n${row()}`, first.book);
  assert.deepEqual(second.errors, []);
  assert.equal(second.added, 1);
  assert.equal(second.duplicates, 1);
});
