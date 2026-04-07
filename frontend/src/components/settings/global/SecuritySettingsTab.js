/*
 * Singra Vox – Security settings tab (2FA)
 */
import TwoFactorSection from "../TwoFactorSection";

export default function SecuritySettingsTab({ token }) {
  return (
    <div className="space-y-6" data-testid="security-settings-panel">
      <section className="workspace-card p-5">
        <TwoFactorSection token={token} />
      </section>
    </div>
  );
}
