import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const i18nSource = read("../src/i18n.ts");
const russianSource = read("../src/locales/ru.ts");
const walletHome = read("../src/pages/WalletHome.tsx");
const header = read("../src/components/layout/Header.tsx");

function initializer(source, name) {
  const file = ts.createSourceFile(name + ".ts", source, ts.ScriptTarget.Latest, true);
  assert.equal(file.parseDiagnostics.length, 0, name + ": invalid dictionary TypeScript syntax");
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return declaration.initializer;
      }
    }
  }
  throw new Error("Missing dictionary: " + name);
}
function property(object, name) {
  assert.ok(ts.isObjectLiteralExpression(object), "Expected dictionary object for " + name);
  const item = object.properties.find((p) =>
    ts.isPropertyAssignment(p) &&
    ((ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name)
  );
  assert.ok(item, "Missing key: " + name);
  return item.initializer;
}
function flatten(object, prefix = "", values = new Map()) {
  assert.ok(ts.isObjectLiteralExpression(object), "Expected object at " + prefix);
  for (const item of object.properties) {
    assert.ok(ts.isPropertyAssignment(item), "Unexpected entry at " + prefix);
    const key = prefix ? prefix + "." + item.name.text : item.name.text;
    if (ts.isObjectLiteralExpression(item.initializer)) {
      flatten(item.initializer, key, values);
    } else {
      assert.ok(ts.isStringLiteralLike(item.initializer), "Non-string translation at " + key);
      assert.ok(!values.has(key), "Duplicate translation key: " + key);
      values.set(key, item.initializer.text);
    }
  }
  return values;
}
const resources = initializer(i18nSource, "resources");
const locales = {
  en: flatten(property(property(resources, "en"), "translation")),
  "zh-TW": flatten(property(property(resources, "zh-TW"), "translation")),
  ru: flatten(property(initializer(russianSource, "ru"), "translation")),
};
const englishKeys = [...locales.en.keys()].sort();
for (const [lang, translations] of Object.entries(locales)) {
  assert.deepEqual([...translations.keys()].sort(), englishKeys, lang + ": translation key mismatch");
  for (const key of [
    "header.theme", "nav.backToLight", "wallet.security.smallAmount",
    "wallet.security.browserStorage", "wallet.security.wordCountValue",
    "wallet.balance.sourceLabel",
  ]) {
    assert.ok(translations.get(key), lang + ": missing " + key);
  }
}
for (const lang of ["zh-TW", "ru"]) {
  for (const key of [
    "wallet.security.backupPhrase", "wallet.security.neverShare",
    "wallet.security.understandRisk", "wallet.actions.forgetWalletConfirm",
  ]) {
    assert.doesNotMatch(locales[lang].get(key), /recovery phrase/i, lang + ": " + key);
  }
}
assert.match(header, /t\("header\.theme"\)/);
assert.match(walletHome, /t\("wallet\.security\.wordCountValue"/);
assert.match(walletHome, /t\("wallet\.balance\.sourceLabel"\)/);
assert.doesNotMatch(walletHome, /<div>Source:/);
console.log("Translation coverage OK: en, zh-TW and ru (" + englishKeys.length + " keys each)");
