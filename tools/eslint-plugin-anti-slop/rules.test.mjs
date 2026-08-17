import { RuleTester } from "eslint";
import parser from "@typescript-eslint/parser";
import plugin from "./index.mjs";

const tester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
  },
});

const cases = {
  "no-chained-type-assertions": {
    valid: ["const value = 'x' as const;", "const value = <string>source;"],
    invalid: [
      { code: "const value = ('x' as string) as number;", errors: 1 },
      { code: "const value = <number>(<string>source);", errors: 1 },
    ],
  },
  "no-conditional-empty-object-spread": {
    valid: ["const value = condition ? { enabled: true } : undefined;"],
    invalid: [{ code: "const value = { ...(condition ? { enabled: true } : {}) };", errors: 1 }],
  },
  "no-known-value-widening": {
    valid: [
      "const value = 'x';",
      "const value: string = `${source}`;",
      "const value: { id: string } = { id: 'x' };",
    ],
    invalid: [
      { code: "const value: string = 'x';", errors: 1 },
      { code: "const value: number = -1;", errors: 1 },
      { code: "const value: object = { id: 'x' } as const;", errors: 1 },
      { code: "const value: Object = { id: 'x' };", errors: 1 },
      { code: "const value: {} = { id: 'x' };", errors: 1 },
      { code: "const value: string | number = 'x';", errors: 1 },
    ],
  },
  "no-module-mocking": {
    valid: ["seam.replace();"],
    invalid: [
      { code: "vi.mock('node:fs');", errors: 1 },
      { code: "jest['doMock']('node:fs');", errors: 1 },
      { code: "jest.unstable_mockModule('node:fs');", errors: 1 },
      { code: "vi[`mock`]('node:fs');", errors: 1 },
    ],
  },
  "no-object-parameters": {
    valid: ["function read(value: { id: string }) { return value.id; }"],
    invalid: [
      { code: "function read(value: object) { return value; }", errors: 1 },
      { code: "function read(value: object = {}) { return value; }", errors: 1 },
      { code: "function read({ id }: object) { return id; }", errors: 1 },
      { code: "class Reader { constructor(private value: object) {} }", errors: 1 },
    ],
  },
  "no-reflect-apply": {
    valid: ["fn(value);"],
    invalid: [
      { code: "Reflect.apply(fn, null, []);", errors: 1 },
      { code: "Reflect['apply'](fn, null, []);", errors: 1 },
    ],
  },
  "no-reflect-get": {
    valid: ["value.name;"],
    invalid: [
      { code: "Reflect.get(value, 'name');", errors: 1 },
      { code: "Reflect[`get`](value, 'name');", errors: 1 },
    ],
  },
  "no-runtime-typeof": {
    valid: ["schema.parse(value);"],
    invalid: [{ code: "typeof value === 'string';", errors: 1 }],
  },
  "no-shape-in-symbol-names": {
    valid: ["const menuBounds = 1;"],
    invalid: [{ code: "const menuShape = 1;", errors: 1 }],
  },
  "no-unknown-parameters": {
    valid: [
      "function fail(cause: unknown) { throw cause; }",
      "function fail(cause: unknown = new Error()) { throw cause; }",
    ],
    invalid: [
      { code: "function parse(value: unknown) { return value; }", errors: 1 },
      { code: "function parse(value: unknown = 'x') { return value; }", errors: 1 },
      { code: "class Parser { constructor(private value: unknown) {} }", errors: 1 },
    ],
  },
  "no-unknown-returns": {
    valid: ["function read(): string { return 'x'; }"],
    invalid: [
      { code: "function read(): unknown { return 'x'; }", errors: 1 },
      { code: "function read(): string | unknown { return 'x'; }", errors: 1 },
      { code: "async function read(): Promise<string | unknown> { return 'x'; }", errors: 1 },
    ],
  },
  "no-unknown-type-aliases": {
    valid: ["type Name = string;"],
    invalid: [
      { code: "type Hidden = unknown;", errors: 1 },
      { code: "type Hidden = string | unknown;", errors: 1 },
    ],
  },
  "no-unsafe-dictionary-type": {
    valid: [
      "type Files = Record<string, { hash: string }>;",
      "type Files = Record<string, string>;",
      "type Files = { [name: string]: number };",
    ],
    invalid: [
      { code: "type Files = Record<string, unknown>;", errors: 1 },
      { code: "type Files = Record<string, Object>;", errors: 1 },
      { code: "type Files = { [name: string]: {} };", errors: 1 },
      { code: "type Files = { [Name in string]: unknown };", errors: 1 },
      { code: "type Files = Record<string, string | unknown>;", errors: 1 },
    ],
  },
  "no-widen-then-assert": {
    valid: [
      "const value = 'x';",
      "{ const value: string = 'x'; } { const value = 'x'; const narrowed = value as 'x'; }",
    ],
    invalid: [
      { code: "const value: string = 'x'; const narrowed = value as 'x';", errors: 1 },
      { code: "const value: string = 'x'; const narrowed = <'x'>value;", errors: 1 },
      { code: "const value: string | number = 'x'; const narrowed = value as 'x';", errors: 1 },
    ],
  },
  "require-safety-comment-for-type-assertion": {
    valid: [
      "const value = 'x' as const;",
      "const value = <const>{ id: 'x' };",
      "// SAFETY: schema checked the literal\nconst value = source as string;",
      "const value = /* SAFETY: schema checked the literal */ source as string;",
      "// SAFETY: schema checked the literal\nconst value = <string>source;",
    ],
    invalid: [
      { code: "const value = source as string;", errors: 1 },
      { code: "// SAFETY:\nconst value = source as string;", errors: 1 },
      { code: "// SAFETY: schema checked the literal\n\nconst value = source as string;", errors: 1 },
      {
        code: "// SAFETY: schema checked the literal\nconst ignored = 1;\nconst value = source as string;",
        errors: 1,
      },
      { code: "const value = <string>source;", errors: 1 },
    ],
  },
};

for (const [name, values] of Object.entries(cases)) {
  tester.run(`anti-slop/${name}`, plugin.rules[name], values);
}
