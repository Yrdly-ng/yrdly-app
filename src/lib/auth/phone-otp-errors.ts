/**
 * Translate public Edge Function responses into safe, actionable OTP messages.
 * Supabase FunctionsHttpError carries the JSON response in error.context.
 * Never display unrecognized provider or backend error content to end users.
 */
type PhoneOtpFailure = {
  message?: unknown;
  context?: { status?: number; json?: () => Promise<unknown> };
};

export async function describePhoneOtpFailure(
  error: unknown,
  responseData?: unknown,
): Promise<string> {
  const failure = (error && typeof error === "object" ? error : {}) as PhoneOtpFailure;
  const status = failure.context?.status;
  let response = responseData;

  if (failure.context && typeof failure.context.json === "function") {
    try {
      response = await failure.context.json();
    } catch {
      // The response may have been consumed or may not be JSON.
    }
  }

  const message = (
    response &&
    typeof response === "object" &&
    "error" in response &&
    typeof response.error === "string"
      ? response.error
      : ""
  ).toLowerCase();

  if (status === 409 || message.includes("already verified on another account")) {
    return "This phone number is already verified on another YRDLY account. Please use a different number or skip phone verification for now.";
  }
  if (status === 429 || message.includes("too many requests")) {
    return "You've requested too many verification codes. Please wait 15 minutes before trying again, or skip this step for now.";
  }
  if (message.includes("invalid nigerian phone") || status === 400) {
    return "Enter a valid Nigerian mobile number without the leading 0 (for example, 8012345678).";
  }
  if (status === 401 || message === "unauthorized" || message === "session revoked") {
    return "Your login session has expired. Please sign in again before verifying your phone.";
  }
  if (status === 403 || message === "account suspended") {
    return "Phone verification is unavailable for this account. Please contact YRDLY support.";
  }
  if (status === 502 || message.includes("unable to send verification code")) {
    return "We couldn't send your SMS verification code. Please try again later or skip this step for now.";
  }
  if (message.includes("unable to save verification session")) {
    return "Your verification session couldn't be saved. Please request a new code or skip for now.";
  }
  if (status === 503 || message.includes("verification unavailable") || message === "account unavailable") {
    return "Phone verification is temporarily unavailable. Please try again later or skip this step for now.";
  }

  return "We couldn't start phone verification. Check your connection and try again, or skip this step for now.";
}
