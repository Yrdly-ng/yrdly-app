const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const React = require("react");

function compile(source, globals) {
  const js = ts.transpileModule(source, {
    fileName: "fixture.tsx",
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", ...Object.keys(globals), js)(
    mod,
    mod.exports,
    ...Object.values(globals),
  );
  return mod.exports;
}

test("route crash fallback reports failure, hides raw exception content and provides an explicit retry", () => {
  let captured = 0,
    recovery = 0,
    resets = 0;
  const { CrashFallback } = compile(
    fs.readFileSync("src/components/CrashFallback.tsx", "utf8"),
    {
      React,
      require: (id) =>
        id === "react"
          ? { ...React, useEffect: (fn) => fn() }
          : {
              captureWebError: () => captured++,
              reportWebRecoveryRequested: () => recovery++,
            },
    },
  );
  const ui = CrashFallback({
    error: new Error("private payload"),
    reset: () => resets++,
  });
  assert.equal(captured, 1);
  assert.ok(!JSON.stringify(ui).includes("private payload"));
  const button = ui.props.children.find((child) => child.type === "button");
  button.props.onClick();
  assert.equal(recovery, 1);
  assert.equal(resets, 1);
});

test("late metadata for a previous file cannot overwrite a newly selected video", async () => {
  const file = "src/components/media/VideoEditDialog.tsx";
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let callback;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "useEffect" &&
      node.arguments[0].getText(source).includes("readVideoMetadata")
    )
      callback = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback);
  const pending = new Map();
  const mounted = { current: true },
    controller = { current: null },
    videoRef = { current: null };
  let metadata, error;
  const run = (file) => {
    const globals = {
      file,
      mounted,
      controller,
      videoRef,
      URL: { createObjectURL: () => file, revokeObjectURL() {} },
      setUrl() {},
      setMetadata: (value) => (metadata = value),
      setStart() {},
      setEnd() {},
      setError: (value) => (error = value),
      setBusy() {},
      setProgress() {},
      readVideoMetadata: (file) =>
        new Promise((resolve, reject) =>
          pending.set(file, { resolve, reject }),
        ),
    };
    const { effect } = compile(`export const effect = ${callback}`, globals);
    return effect();
  };
  const cleanupA = run("a");
  cleanupA();
  const cleanupB = run("b");
  pending.get("b").resolve({ duration: 2 });
  await new Promise((resolve) => setImmediate(resolve));
  pending.get("a").resolve({ duration: 900 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(metadata.duration, 2);
  assert.equal(error, "");
  cleanupB();
  assert.equal(mounted.current, false);
});
