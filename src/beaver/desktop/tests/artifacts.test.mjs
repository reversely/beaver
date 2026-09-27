// Keeps the artifact registry, its spec, and the notebook code in agreement.
// Run: node --test src/beaver/desktop/tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PIECES, SPECS, THEME_PIECE, runChecks } from "../ui/artifact-specs.js";

const here = new URL("..", import.meta.url);
const spec = readFileSync(new URL("artifacts.md", here), "utf8");
const python = readFileSync(new URL("notebooks.py", here), "utf8");

// The spec writes 1,000 and above with thousands separators.
const written = (mm) => (mm >= 1000 ? mm.toLocaleString("en-US") : String(mm));

test("every dimension check passes", () => {
  for (const { name, pass } of runChecks()) assert.ok(pass, name);
});

test("every registry value appears in the spec", () => {
  for (const [piece, dims] of Object.entries(SPECS)) {
    for (const [key, { mm }] of Object.entries(dims)) {
      assert.ok(spec.includes(written(mm)), `${piece}.${key} = ${written(mm)} is missing from artifacts.md`);
    }
  }
});

test("every cited source exists in the spec's source table", () => {
  const listed = new Set([...spec.matchAll(/^\| (S\d+) \|/gm)].map((m) => m[1]));
  for (const [piece, dims] of Object.entries(SPECS)) {
    for (const [key, { source, kind }] of Object.entries(dims)) {
      if (kind === "stylized" && source === null) continue;
      assert.ok(listed.has(source), `${piece}.${key} cites ${source}, which the source table lacks`);
    }
  }
});

test("sourced and ranged values name a source", () => {
  for (const [piece, dims] of Object.entries(SPECS)) {
    for (const [key, { source, kind }] of Object.entries(dims)) {
      if (kind !== "stylized") assert.ok(source, `${piece}.${key} is ${kind} with no source`);
    }
  }
});

test("the Python piece list matches the registry", () => {
  const block = python.match(/^PIECES = \[([\s\S]*?)\]/m)[1];
  const names = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(names, PIECES);
});

test("every theme falls back to a real piece", () => {
  for (const piece of Object.values(THEME_PIECE)) assert.ok(PIECES.includes(piece), piece);
});
