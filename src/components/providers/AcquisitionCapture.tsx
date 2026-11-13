"use client";

import { useEffect } from "react";
import { captureAcquisitionLanding } from "@/lib/attribution/signup";

/** Read only bounded campaign/referrer data. Never capture arbitrary URLs. */
export function AcquisitionCapture() {
  useEffect(() => { captureAcquisitionLanding(); }, []);
  return null;
}
