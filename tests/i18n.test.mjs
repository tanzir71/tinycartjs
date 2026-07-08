import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const widget = readFileSync(join(root, "tinycart.js"), "utf8");
const stringsMatch = widget.match(/const STRINGS=({[\s\S]*?});const s=/);
assert.ok(stringsMatch, "tinycart.js should expose STRINGS");
const strings = Function(`return ${stringsMatch[1]}`)();
const keys = Object.keys(strings).sort();

for (const locale of ["bn", "hi", "ur", "ar", "es", "fr"]) {
  test(`${locale}.json covers every widget string key`, () => {
    const file = join(root, "examples", "strings", `${locale}.json`);
    const pack = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(pack).sort(), keys);

    for (const key of keys) {
      assert.equal(typeof pack[key], "string", `${locale}.${key} should be a string`);
      const sourceVars = (strings[key].match(/\{\{[^}]+\}\}/g) || []).sort();
      const packVars = (pack[key].match(/\{\{[^}]+\}\}/g) || []).sort();
      assert.deepEqual(packVars, sourceVars, `${locale}.${key} should keep placeholders`);
    }
  });
}
