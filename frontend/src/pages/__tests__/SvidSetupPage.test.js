/*
 * Singra Vox - SvidSetupPage smoke tests
 */
import { renderToStaticMarkup } from "react-dom/server";

const mockAuthState = {
  user: {
    id: "user-1",
    email: "alice@example.com",
    username: "alice",
    display_name: "Alice",
    avatar_url: "https://cdn.example.com/avatar.png",
    svid_account_id: null,
  },
  linkSvid: jest.fn(),
};

const mockFlowState = {
  form: {
    email: "alice@example.com",
    username: "alice",
    displayName: "Alice",
    password: "",
    setEmail: jest.fn(),
    setUsername: jest.fn(),
    setDisplayName: jest.fn(),
    setPassword: jest.fn(),
  },
  verification: {
    verificationSent: false,
    verifyEmail: "",
    verifyCode: "",
    setVerifyCode: jest.fn(),
    verified: false,
    finalizationPending: false,
  },
  status: {
    error: "",
    loading: false,
    verifying: false,
  },
  actions: {
    handleSubmit: jest.fn(),
    handleVerifyCode: jest.fn(),
    handleResendCode: jest.fn(),
    retryPostVerification: jest.fn(),
    clearError: jest.fn(),
  },
};

const TRANSLATIONS = {
  "svid.setupTitle": "Singra-ID einrichten",
  "svid.setupSuccessTitle": "Singra-ID ist eingerichtet",
  "svid.setupFinalizeRetry": "Verknüpfung erneut versuchen",
};

jest.mock("react-router-dom", () => ({
  __esModule: true,
  Navigate: () => null,
  useNavigate: () => jest.fn(),
}), { virtual: true });

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => TRANSLATIONS[key] || key }),
}), { virtual: true });

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}), { virtual: true });

jest.mock("@/components/ui/input", () => ({
  Input: (props) => <input {...props} />,
}), { virtual: true });

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }) => <label {...props}>{children}</label>,
}), { virtual: true });

jest.mock("@/components/ui/PasswordInput", () => ({
  __esModule: true,
  default: ({ value = "", testId }) => <input data-testid={testId} value={value} readOnly />,
}), { virtual: true });

jest.mock("@/components/auth/AuthShell", () => ({
  __esModule: true,
  default: ({ title, subtitle, children }) => (
    <section>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </section>
  ),
}), { virtual: true });

jest.mock("@/components/ui/LocalizedErrorBanner", () => ({
  __esModule: true,
  default: ({ message }) => (message ? <div>{message}</div> : null),
}), { virtual: true });

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    defaults: { baseURL: "/api" },
  },
}), { virtual: true });

jest.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mockAuthState,
}), { virtual: true });

jest.mock("@/pages/svid/useSvidRegistrationFlow", () => ({
  __esModule: true,
  default: () => mockFlowState,
}), { virtual: true });

import SvidSetupPage from "../SvidSetupPage";

describe("SvidSetupPage", () => {
  beforeEach(() => {
    mockAuthState.user = {
      id: "user-1",
      email: "alice@example.com",
      username: "alice",
      display_name: "Alice",
      avatar_url: "https://cdn.example.com/avatar.png",
      svid_account_id: null,
    };
    mockAuthState.linkSvid = jest.fn();
    mockFlowState.form = {
      email: "alice@example.com",
      username: "alice",
      displayName: "Alice",
      password: "",
      setEmail: jest.fn(),
      setUsername: jest.fn(),
      setDisplayName: jest.fn(),
      setPassword: jest.fn(),
    };
    mockFlowState.verification = {
      verificationSent: false,
      verifyEmail: "",
      verifyCode: "",
      setVerifyCode: jest.fn(),
      verified: false,
      finalizationPending: false,
    };
    mockFlowState.status = {
      error: "",
      loading: false,
      verifying: false,
    };
    mockFlowState.actions = {
      handleSubmit: jest.fn(),
      handleVerifyCode: jest.fn(),
      handleResendCode: jest.fn(),
      retryPostVerification: jest.fn(),
      clearError: jest.fn(),
    };
  });

  it("renders the upgrade form with prefilled local profile data", () => {
    const markup = renderToStaticMarkup(<SvidSetupPage />);

    expect(markup).toContain("svid-setup-page");
    expect(markup).toContain("svid-setup-email");
    expect(markup).toContain("alice@example.com");
    expect(markup).toContain("svid-setup-username");
    expect(markup).toContain("value=\"alice\"");
    expect(markup).toContain("Singra-ID einrichten");
  });

  it("keeps the success screen visible after linking updates the auth user", () => {
    mockAuthState.user = {
      ...mockAuthState.user,
      svid_account_id: "svid-acc-1",
    };
    mockFlowState.verification = {
      ...mockFlowState.verification,
      verified: true,
    };

    const markup = renderToStaticMarkup(<SvidSetupPage />);

    expect(markup).toContain("svid-setup-success");
    expect(markup).toContain("Singra-ID ist eingerichtet");
  });

  it("renders a retry state after email verification succeeded but linking did not finish", () => {
    mockFlowState.verification = {
      ...mockFlowState.verification,
      verificationSent: true,
      finalizationPending: true,
    };
    mockFlowState.status = {
      ...mockFlowState.status,
      error: "Failed to sync avatar.",
    };

    const markup = renderToStaticMarkup(<SvidSetupPage />);

    expect(markup).toContain("svid-setup-retry-linking");
    expect(markup).toContain("Failed to sync avatar.");
    expect(markup).toContain("Verknüpfung erneut versuchen");
    expect(markup).not.toContain("svid-setup-verify-form");
  });
});
