#!/usr/bin/env node
/**
 * Minimal Payluk API client for agents and humans. Node 18+, no dependencies.
 *
 * Usage:
 *   node payluk-request.mjs <METHOD> <path> [options]
 *
 * Options:
 *   --json '<json>'          Send a JSON body (Content-Type: application/json).
 *   --form key=value         Send multipart/form-data. Repeatable. Use key=@path to attach a file.
 *   --query key=value        Append a query parameter. Repeatable.
 *   --customer <id>          Set the customer-id header (or export PAYLUK_CUSTOMER_ID).
 *   --no-customer            Force no customer-id header even if PAYLUK_CUSTOMER_ID is set.
 *   --base <url>             Override the base URL (otherwise chosen from the key prefix).
 *   --raw                    Print the raw response body instead of pretty JSON.
 *
 * Environment:
 *   PAYLUK_SECRET_KEY        Required. sk_test_... picks staging, sk_live_... picks production.
 *   PAYLUK_CUSTOMER_ID       Optional default for --customer.
 *   PAYLUK_BASE_URL          Optional default for --base.
 *
 * Examples:
 *   node payluk-request.mjs GET /v1/countries
 *   node payluk-request.mjs POST /v1/customer/create --json '{"firstname":"Ada","lastname":"Eze","email":"ada@example.com","phone":"08012345678"}'
 *   node payluk-request.mjs POST /v1/escrow/create --customer 665f... --form amount=150000 --form "purpose=MacBook" --form whoPays=both
 *   node payluk-request.mjs GET /v1/escrow/transactions --customer 665f... --query type=sales --query limit=5
 *
 * Exit code is 1 when the envelope's status is 400 or above, so it composes in shell scripts.
 *
 * Git Bash on Windows rewrites arguments that start with "/" into Windows paths. Prefix the
 * command with MSYS_NO_PATHCONV=1, or pass the path without the leading slash (v1/countries).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const STAGING = "https://staging.api.payluk.ng";
const PRODUCTION = "https://api.payluk.ng";

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  const doc = readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].split("/**")[1] ?? "";
  console.error(doc.replace(/^ \* ?/gm, "").trim());
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 2) usage();
const [method, path, ...rest] = argv;

const opts = { form: [], query: [], json: undefined, customer: process.env.PAYLUK_CUSTOMER_ID, base: process.env.PAYLUK_BASE_URL, raw: false, noCustomer: false };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  const next = () => {
    if (i + 1 >= rest.length) usage(`${a} needs a value`);
    return rest[++i];
  };
  switch (a) {
    case "--json": opts.json = next(); break;
    case "--form": opts.form.push(next()); break;
    case "--query": opts.query.push(next()); break;
    case "--customer": opts.customer = next(); break;
    case "--no-customer": opts.noCustomer = true; break;
    case "--base": opts.base = next(); break;
    case "--raw": opts.raw = true; break;
    default: usage(`unknown option ${a}`);
  }
}

const key = process.env.PAYLUK_SECRET_KEY;
if (!key) usage("PAYLUK_SECRET_KEY is not set");
if (!/^sk_(test|live)_/.test(key)) usage("PAYLUK_SECRET_KEY must start with sk_test_ or sk_live_");

const base = (opts.base ?? (key.startsWith("sk_live_") ? PRODUCTION : STAGING)).replace(/\/$/, "");
if (opts.base === undefined && key.startsWith("sk_live_")) console.error("note: sk_live_ key, calling PRODUCTION");

const url = new URL(base + (path.startsWith("/") ? path : `/${path}`));
for (const q of opts.query) {
  const eq = q.indexOf("=");
  if (eq < 1) usage(`--query expects key=value, got ${q}`);
  url.searchParams.append(q.slice(0, eq), q.slice(eq + 1));
}

// Connection: close lets the process end on its own once the response is printed.
const headers = { Authorization: `Bearer ${key}`, Accept: "application/json", Connection: "close" };
if (opts.customer && !opts.noCustomer) headers["customer-id"] = opts.customer;

let body;
if (opts.json !== undefined && opts.form.length) usage("use either --json or --form, not both");
if (opts.json !== undefined) {
  try { JSON.parse(opts.json); } catch { usage("--json is not valid JSON"); }
  headers["Content-Type"] = "application/json";
  body = opts.json;
} else if (opts.form.length) {
  const fd = new FormData();
  for (const f of opts.form) {
    const eq = f.indexOf("=");
    if (eq < 1) usage(`--form expects key=value, got ${f}`);
    const k = f.slice(0, eq);
    const v = f.slice(eq + 1);
    if (v.startsWith("@")) {
      const file = v.slice(1);
      fd.append(k, new Blob([readFileSync(file)]), basename(file));
    } else {
      fd.append(k, v);
    }
  }
  body = fd; // fetch sets the multipart boundary itself
}

const res = await fetch(url, { method: method.toUpperCase(), headers, body });
const text = await res.text();

// Set exitCode instead of calling process.exit(): exiting while fetch's socket is still
// closing trips a libuv assertion on Windows.
if (opts.raw) {
  process.stdout.write(text + (text.endsWith("\n") ? "" : "\n"));
  process.exitCode = res.status >= 400 ? 1 : 0;
} else {
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }

  console.error(`${method.toUpperCase()} ${url} -> ${res.status}`);
  console.log(parsed === undefined ? text : JSON.stringify(parsed, null, 2));
  const status = typeof parsed?.status === "number" ? parsed.status : res.status;
  process.exitCode = status >= 400 ? 1 : 0;
}
