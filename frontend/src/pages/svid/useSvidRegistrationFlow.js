/*
 * Singra Vox - Shared Singra-ID registration flow
 *
 * Reuses the same register -> verify-email -> post-verify handoff logic for
 * both standalone Singra-ID sign-up and the local-account upgrade flow.
 */
import { useCallback, useState } from "react";
import api from "@/lib/api";

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
      if (onVerified && response.data?.access_token) {
        await onVerified(response.data);
      }
      setVerified(true);
      return response.data;
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === "object" && detail?.errors) {
        setError(detail.errors.join(". "));
      } else {
        setError(typeof detail === "string" ? detail : "Registration failed.");
      }
    } finally {
      setLoading(false);
    }
  }, [displayName, email, onVerified, password, username]);

  const handleVerifyCode = useCallback(async (event) => {
    event.preventDefault();
    setError("");
    setVerifying(true);
    try {
      const response = await api.post("/id/verify-email", {
        email: verifyEmail,
        code: verifyCode.trim(),
      });
      if (onVerified) {
        await onVerified(response.data);
      }
      setVerified(true);
      return response.data;
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : invalidCodeMessage);
    } finally {
      setVerifying(false);
    }
  }, [invalidCodeMessage, onVerified, verifyCode, verifyEmail]);

  const handleResendCode = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const response = await api.post("/id/resend-verification", { email: verifyEmail });
      return response.data;
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not resend code.");
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
      clearError: () => setError(""),
    },
  };
}
