import { NextResponse } from "next/server";
export function GET() {
  const fingerprints = (process.env.ANDROID_APP_LINK_SHA256_FINGERPRINTS || "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
  const links = fingerprints.length
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "com.yrdly",
            sha256_cert_fingerprints: [...new Set(fingerprints)],
          },
        },
      ]
    : [];
  return NextResponse.json(links, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
