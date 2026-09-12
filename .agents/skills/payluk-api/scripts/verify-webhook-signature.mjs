#!/usr/bin/env node
/**
 * Verify a Payluk webhook signature (hex HMAC-SHA512 of the raw body, keyed with the
 * environment's secret key). Node 18+, no dependencies.
 *
 * As a module:
 *   import { verifyPaylukSignature, signPaylukBody } from "./verify-webhook-signature.mjs";
 *   verifyPaylukSignature(rawBodyBuffer, req.headers["x-payluk-signature"], process.env.PAYLUK_SECRET_KEY); // boolean
 *
 * From the shell:
 *   PAYLUK_SECRET_KEY=sk_test_... node verify-webhook-signature.mjs <signature> [body-file]
 *   cat body.json | PAYLUK_SECRET_KEY=sk_test_... node verify-webhook-signature.mjs <signature>
 *   PAYLUK_SECRET_KEY=sk_test_... node verify-webhook-signature.mjs --sign body.json   # prints the signature, handy for testing your handler
 *
 * Exit code 0 when valid, 1 when invalid, 2 on usage errors.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function signPaylukBody(rawBody, secret) {
  return createHmac("sha512", secret).update(rawBody).digest("hex");
}

export function verifyPaylukSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = Buffer.from(signPaylukBody(rawBody, secret), "utf8");
  const received = Buffer.from(String(signature).trim(), "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const secret = process.env.PAYLUK_SECRET_KEY;
  const args = process.argv.slice(2);
  if (!secret) { console.error("PAYLUK_SECRET_KEY is not set"); process.exit(2); }

  const readBody = (file) => (file ? readFileSync(file) : readFileSync(0));

  if (args[0] === "--sign") {
    console.log(signPaylukBody(readBody(args[1]), secret));
    process.exit(0);
  }

  const [signature, file] = args;
  if (!signature) { console.error("usage: verify-webhook-signature.mjs <signature> [body-file]"); process.exit(2); }
  const ok = verifyPaylukSignature(readBody(file), signature, secret);
  console.log(ok ? "valid" : "invalid");
  process.exit(ok ? 0 : 1);
}
