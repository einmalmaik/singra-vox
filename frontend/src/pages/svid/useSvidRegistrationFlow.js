/*
 * Singra Vox - Shared Singra-ID registration flow
 *
 * Reuses the same register -> verify-email -> post-verify handoff logic for
 * both standalone Singra-ID sign-up and the local-account upgrade flow.
 */
import { useCallback, useRef, useState } from "react";
import api from "@/lib/api";

function resolveFlowError(error, fallbackMessage) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "object" && Array.isArray(detail?.errors)) {
    return detail.errors.join(". ");
  }
  if (typeof detail === "string" && detail) {
    return detail;
  }
  if (typeof error?.message === "string" && error.message) {
    return error.message;
  }
  return fallbackMessage;
}

export default function useSvidRegistrationFlow({ initialProfile = {}, onVerified = null, invalidCodeMessage = "Invalid verification code." } = {}) {
  const [email, setEmail] = useState(initialProfile.email || "");
  const [username, setUsername] = useState(initialProfile.username || "");
  const [displayName, setDisplayName] = useState(initialProfile.displayName || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [finalizationPending, setFinalizationPending] = useState(false);
  const verifiedSessionRef = useRef(null);

  const finalizeVerifiedSession = useCallback(async (sessionData) => {
    verifiedSessionRef.current = sessionData;
    setFinalizationPending(Boolean(onVerified));
    if (onVerified) {
      await onVerified(sessionData);
    }
    setError("");
    setFinalizationPending(false);
    setVerified(true);
    return sessionData;
  }, [onVerified]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/id/register", {
        email,
        username: username.toLowerCase().trim(),
        password,
        display_name: displayName || username,
      });
      if (response.data?.verification_required) {
        setVerificationSent(true);
        setVerifyEmail(response.data.email);
        return response.data;
      }
      return await finalizeVerifiedSession(response.data);
    } catch (err) {
      setError(resolveFlowError(err, "Registration failed."));
    } finally {
      setLoading(false);
    }
  }, [displayName, email, finalizeVerifiedSession, password, username]);

  const handleVerifyCode = useCallback(async (event) => {
    event.preventDefault();
    setError("");
    setVerifying(true);
    try {
      const response = await api.post("/id/verify-email", {
        email: verifyEmail,
        code: verifyCode.trim(),
      });
      return await finalizeVerifiedSession(response.data);
    } catch (err) {
      setError(resolveFlowError(err, invalidCodeMessage));
    } finally {
      setVerifying(false);
    }
  }, [finalizeVerifiedSession, invalidCodeMessage, verifyCode, verifyEmail]);

  const retryPostVerification = useCallback(async () => {
    if (!verifiedSessionRef.current || verified) {
      return null;
    }
    setError("");
    setVerifying(true);
    try {
      return await finalizeVerifiedSession(verifiedSessionRef.current);
    } catch (err) {
      setError(resolveFlowError(err, "Could not finish account setup."));
      return null;
    } finally {
      setVerifying(false);
    }
  }, [finalizeVerifiedSession, verified]);

  const handleResendCode = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/id/resend-verification", { email: verifyEmail });
      return response.data;
    } catch (err) {
      setError(resolveFlowError(err, "Could not resend code."));
    } finally {
      setLoading(false);
    }
  }, [verifyEmail]);

  return {
    form: {
      email,
      username,
      displayName,
      password,
      setEmail,
      setUsername,
      setDisplayName,
      setPassword,
    },
    verification: {
      verificationSent,
      verifyEmail,
      verifyCode,
      setVerifyCode,
      verified,
      finalizationPending,
    },
    status: {
      error,
      loading,
      verifying,
    },
    actions: {
      handleSubmit,
      handleVerifyCode,
      handleResendCode,
      retryPostVerification,
      clearError: () => setError(""),
    },
  };
}
