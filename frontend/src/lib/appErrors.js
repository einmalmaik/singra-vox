import { formatError } from "@/lib/api";

const ERROR_CODE_KEYS = {
  not_authenticated: "errors.codes.not_authenticated",
  invalid_token: "errors.codes.invalid_token",
  token_expired: "errors.codes.token_expired",
  session_revoked: "errors.codes.session_revoked",
  user_not_found: "errors.codes.user_not_found",
  invalid_refresh_token: "errors.codes.invalid_refresh_token",
  refresh_token_reused: "errors.codes.refresh_token_reused",
  refresh_token_expired: "errors.codes.refresh_token_expired",
  rate_limited: "errors.codes.rate_limited",
  login_rate_limited: "errors.codes.login_rate_limited",
  refresh_rate_limited: "errors.codes.refresh_rate_limited",
  verify_email_rate_limited: "errors.codes.verify_email_rate_limited",
  resend_verification_rate_limited: "errors.codes.resend_verification_rate_limited",
  forgot_password_rate_limited: "errors.codes.forgot_password_rate_limited",
  reset_password_rate_limited: "errors.codes.reset_password_rate_limited",
  email_verification_required: "errors.codes.email_verification_required",
  legacy_signaling_disabled: "errors.codes.legacy_signaling_disabled",
};

export function extractErrorDetail(error) {
  if (error?.response?.data?.detail !== undefined) {
    return error.response.data.detail;
  }
  if (error?.detail !== undefined) {
    return error.detail;
  }
  return error;
}

function translateCode(t, code, params = {}, fallbackMessage = "") {
  if (!t || !code) {
    return fallbackMessage || "";
  }

  const key = ERROR_CODE_KEYS[code];
  if (!key) {
    return fallbackMessage || "";
  }

  const translated = t(key, {
    defaultValue: fallbackMessage || "",
    ...params,
  });
  return translated || fallbackMessage || "";
}

export function formatAppError(t, error, options = {}) {
  const {
    fallbackKey = "errors.unknown",
    fallbackMessage = "",
    fallbackParams = {},
  } = options;
  const detail = extractErrorDetail(error);

  if (Array.isArray(detail)) {
    const joined = detail
      .map((entry) => formatAppError(t, entry, { fallbackKey, fallbackMessage, fallbackParams }))
      .filter(Boolean)
      .join(" ");
    if (joined) {
      return joined;
    }
  }

  if (detail && typeof detail === "object") {
    const translated = translateCode(
      t,
      detail.code,
      detail.params || {},
      detail.message || "",
    );
    if (translated) {
      return translated;
    }
    if (detail.message) {
      return detail.message;
    }
    if (detail.msg) {
      return detail.msg;
    }
  }

  const formatted = formatError(detail);
  if (formatted && formatted !== "Something went wrong.") {
    return formatted;
  }

  if (fallbackMessage) {
    return fallbackMessage;
  }

  return t ? t(fallbackKey, fallbackParams) : "Something went wrong.";
}
