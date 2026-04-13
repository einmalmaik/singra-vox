/*
 * Singra Vox - Shared Singra-ID registration flow tests
 */
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import api from "@/lib/api";
import useSvidRegistrationFlow from "../useSvidRegistrationFlow";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
  },
}), { virtual: true });

describe("useSvidRegistrationFlow", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createHarness(onVerified = null) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let latestValue = null;

    function Probe() {
      const value = useSvidRegistrationFlow({
        onVerified,
        invalidCodeMessage: "Invalid verification code.",
      });

      useEffect(() => {
        latestValue = value;
      });

      return null;
    }

    return {
      get value() {
        return latestValue;
      },
      render: async () => {
        await act(async () => {
          root.render(<Probe />);
        });
      },
      cleanup: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it("keeps a retry path after verify-email succeeded but post-verification linking failed", async () => {
    const onVerified = jest.fn()
      .mockRejectedValueOnce(new Error("Failed to sync avatar."))
      .mockResolvedValueOnce({ ok: true });
    api.post
      .mockResolvedValueOnce({
        data: {
          verification_required: true,
          email: "alice@example.com",
        },
      })
      .mockResolvedValueOnce({
        data: {
          access_token: "token-1",
          refresh_token: "refresh-1",
          session_id: "session-1",
        },
      });
    const harness = createHarness(onVerified);

    try {
      await harness.render();

      await act(async () => {
        harness.value.form.setEmail("alice@example.com");
        harness.value.form.setUsername("alice");
        harness.value.form.setDisplayName("Alice");
        harness.value.form.setPassword("Password123!");
      });

      await act(async () => {
        await harness.value.actions.handleSubmit({ preventDefault() {} });
      });

      expect(harness.value.verification.verificationSent).toBe(true);
      expect(harness.value.verification.verifyEmail).toBe("alice@example.com");

      await act(async () => {
        harness.value.verification.setVerifyCode("123456");
      });

      await act(async () => {
        await harness.value.actions.handleVerifyCode({ preventDefault() {} });
      });

      expect(api.post).toHaveBeenNthCalledWith(1, "/id/register", {
        email: "alice@example.com",
        username: "alice",
        password: "Password123!",
        display_name: "Alice",
      });
      expect(api.post).toHaveBeenNthCalledWith(2, "/id/verify-email", {
        email: "alice@example.com",
        code: "123456",
      });
      expect(onVerified).toHaveBeenCalledTimes(1);
      expect(harness.value.verification.verified).toBe(false);
      expect(harness.value.verification.finalizationPending).toBe(true);
      expect(harness.value.status.error).toBe("Failed to sync avatar.");

      await act(async () => {
        await harness.value.actions.retryPostVerification();
      });

      expect(api.post).toHaveBeenCalledTimes(2);
      expect(onVerified).toHaveBeenCalledTimes(2);
      expect(harness.value.verification.verified).toBe(true);
      expect(harness.value.verification.finalizationPending).toBe(false);
      expect(harness.value.status.error).toBe("");
      expect(harness.value.status.verifying).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });
});
