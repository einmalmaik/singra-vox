"""
Test suite for Singra Vox Email Template System
================================================

Tests the centralized email template module (email_templates.py) and
the backward-compatible re-exports in emailing.py.

Features tested:
- All 5 render functions return valid (subject, text, html) tuples
- HTML outputs contain mauntingstudios branding in footer
- HTML outputs contain fox logo SVG
- Verification/password reset emails show code in large font
- Welcome email contains username and optional button
- Invite email contains inviter name, server name, and button
- Security alert email contains alert type and details
"""
import pytest
import os
import sys

# Add backend to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))


class TestEmailTemplateImports:
    """Test that imports from app.emailing work correctly (backward compatibility)."""

    def test_import_render_verification_email_from_emailing(self):
        """Verify render_verification_email can be imported from app.emailing."""
        from app.emailing import render_verification_email
        assert callable(render_verification_email)
        print("✓ render_verification_email imported from app.emailing")

    def test_import_render_password_reset_email_from_emailing(self):
        """Verify render_password_reset_email can be imported from app.emailing."""
        from app.emailing import render_password_reset_email
        assert callable(render_password_reset_email)
        print("✓ render_password_reset_email imported from app.emailing")

    def test_import_send_email_from_emailing(self):
        """Verify send_email can be imported from app.emailing."""
        from app.emailing import send_email
        assert callable(send_email)
        print("✓ send_email imported from app.emailing")

    def test_import_all_render_functions_from_emailing(self):
        """Verify all 5 render functions can be imported from app.emailing."""
        from app.emailing import (
            render_verification_email,
            render_password_reset_email,
            render_welcome_email,
            render_invite_email,
            render_security_alert_email,
        )
        assert callable(render_verification_email)
        assert callable(render_password_reset_email)
        assert callable(render_welcome_email)
        assert callable(render_invite_email)
        assert callable(render_security_alert_email)
        print("✓ All 5 render functions imported from app.emailing")

    def test_import_from_email_templates_directly(self):
        """Verify functions can also be imported directly from email_templates."""
        from app.email_templates import (
            render_verification_email,
            render_password_reset_email,
            render_welcome_email,
            render_invite_email,
            render_security_alert_email,
        )
        assert callable(render_verification_email)
        assert callable(render_password_reset_email)
        assert callable(render_welcome_email)
        assert callable(render_invite_email)
        assert callable(render_security_alert_email)
        print("✓ All 5 render functions imported from app.email_templates")


class TestVerificationEmail:
    """Test render_verification_email function."""

    def test_returns_valid_tuple(self):
        """Verify function returns (subject, text, html) tuple."""
        from app.email_templates import render_verification_email
        result = render_verification_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="123456",
            expires_minutes=15,
        )
        assert isinstance(result, tuple)
        assert len(result) == 3
        subject, text, html = result
        assert isinstance(subject, str)
        assert isinstance(text, str)
        assert isinstance(html, str)
        print(f"✓ Verification email returns valid tuple: subject='{subject[:50]}...'")

    def test_html_contains_mauntingstudios(self):
        """Verify HTML footer contains mauntingstudios branding."""
        from app.email_templates import render_verification_email
        _, _, html = render_verification_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="123456",
            expires_minutes=15,
        )
        assert "mauntingstudios" in html
        print("✓ Verification email HTML contains 'mauntingstudios'")

    def test_html_contains_fox_logo_svg(self):
        """Verify HTML contains fox logo SVG."""
        from app.email_templates import render_verification_email
        _, _, html = render_verification_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="123456",
            expires_minutes=15,
        )
        # Check for SVG elements that are part of the fox logo
        assert "svg" in html.lower()
        assert "polygon" in html.lower() or "path" in html.lower()
        print("✓ Verification email HTML contains fox logo SVG")

    def test_code_displayed_in_large_font(self):
        """Verify verification code is displayed in large font (34px)."""
        from app.email_templates import render_verification_email
        _, _, html = render_verification_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="123456",
            expires_minutes=15,
        )
        # Check for large font size in code display
        assert "font-size: 34px" in html or "font-size:34px" in html
        assert "123456" in html
        print("✓ Verification email shows code '123456' in large font (34px)")

    def test_text_body_contains_code(self):
        """Verify plaintext body contains the verification code."""
        from app.email_templates import render_verification_email
        _, text, _ = render_verification_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="ABCDEF",
            expires_minutes=15,
        )
        assert "ABCDEF" in text
        print("✓ Verification email text body contains code")


class TestPasswordResetEmail:
    """Test render_password_reset_email function."""

    def test_returns_valid_tuple(self):
        """Verify function returns (subject, text, html) tuple."""
        from app.email_templates import render_password_reset_email
        result = render_password_reset_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="654321",
            expires_minutes=15,
        )
        assert isinstance(result, tuple)
        assert len(result) == 3
        subject, text, html = result
        assert isinstance(subject, str)
        assert isinstance(text, str)
        assert isinstance(html, str)
        print(f"✓ Password reset email returns valid tuple: subject='{subject[:50]}...'")

    def test_html_contains_mauntingstudios(self):
        """Verify HTML footer contains mauntingstudios branding."""
        from app.email_templates import render_password_reset_email
        _, _, html = render_password_reset_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="654321",
            expires_minutes=15,
        )
        assert "mauntingstudios" in html
        print("✓ Password reset email HTML contains 'mauntingstudios'")

    def test_html_contains_fox_logo_svg(self):
        """Verify HTML contains fox logo SVG."""
        from app.email_templates import render_password_reset_email
        _, _, html = render_password_reset_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="654321",
            expires_minutes=15,
        )
        assert "svg" in html.lower()
        print("✓ Password reset email HTML contains fox logo SVG")

    def test_code_displayed_in_large_font(self):
        """Verify reset code is displayed in large font (34px)."""
        from app.email_templates import render_password_reset_email
        _, _, html = render_password_reset_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            code="654321",
            expires_minutes=15,
        )
        assert "font-size: 34px" in html or "font-size:34px" in html
        assert "654321" in html
        print("✓ Password reset email shows code '654321' in large font (34px)")


class TestWelcomeEmail:
    """Test render_welcome_email function."""

    def test_returns_valid_tuple(self):
        """Verify function returns (subject, text, html) tuple."""
        from app.email_templates import render_welcome_email
        result = render_welcome_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            username="testuser",
        )
        assert isinstance(result, tuple)
        assert len(result) == 3
        subject, text, html = result
        assert isinstance(subject, str)
        assert isinstance(text, str)
        assert isinstance(html, str)
        print(f"✓ Welcome email returns valid tuple: subject='{subject[:50]}...'")

    def test_html_contains_mauntingstudios(self):
        """Verify HTML footer contains mauntingstudios branding."""
        from app.email_templates import render_welcome_email
        _, _, html = render_welcome_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            username="testuser",
        )
        assert "mauntingstudios" in html
        print("✓ Welcome email HTML contains 'mauntingstudios'")

    def test_html_contains_fox_logo_svg(self):
        """Verify HTML contains fox logo SVG."""
        from app.email_templates import render_welcome_email
        _, _, html = render_welcome_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            username="testuser",
        )
        assert "svg" in html.lower()
        print("✓ Welcome email HTML contains fox logo SVG")

    def test_contains_username(self):
        """Verify welcome email contains the username."""
        from app.email_templates import render_welcome_email
        _, text, html = render_welcome_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            username="johndoe",
        )
        assert "johndoe" in text
        assert "johndoe" in html
        print("✓ Welcome email contains username 'johndoe'")

    def test_optional_button_without_url(self):
        """Verify welcome email works without login_url (no button)."""
        from app.email_templates import render_welcome_email
        _, _, html = render_welcome_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            username="testuser",
            login_url="",
        )
        # Should not contain button when no URL provided
        assert "Open Singra Vox" not in html
        print("✓ Welcome email without login_url has no button")

    def test_optional_button_with_url(self):
        """Verify welcome email includes button when login_url is provided."""
        from app.email_templates import render_welcome_email
        _, _, html = render_welcome_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            username="testuser",
            login_url="https://example.com/login",
        )
        assert "Open Singra Vox" in html
        assert "https://example.com/login" in html
        print("✓ Welcome email with login_url includes button")


class TestInviteEmail:
    """Test render_invite_email function."""

    def test_returns_valid_tuple(self):
        """Verify function returns (subject, text, html) tuple."""
        from app.email_templates import render_invite_email
        result = render_invite_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            inviter_name="Alice",
            server_name="Gaming Hub",
            invite_url="https://example.com/invite/abc123",
        )
        assert isinstance(result, tuple)
        assert len(result) == 3
        subject, text, html = result
        assert isinstance(subject, str)
        assert isinstance(text, str)
        assert isinstance(html, str)
        print(f"✓ Invite email returns valid tuple: subject='{subject[:50]}...'")

    def test_html_contains_mauntingstudios(self):
        """Verify HTML footer contains mauntingstudios branding."""
        from app.email_templates import render_invite_email
        _, _, html = render_invite_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            inviter_name="Alice",
            server_name="Gaming Hub",
            invite_url="https://example.com/invite/abc123",
        )
        assert "mauntingstudios" in html
        print("✓ Invite email HTML contains 'mauntingstudios'")

    def test_html_contains_fox_logo_svg(self):
        """Verify HTML contains fox logo SVG."""
        from app.email_templates import render_invite_email
        _, _, html = render_invite_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            inviter_name="Alice",
            server_name="Gaming Hub",
            invite_url="https://example.com/invite/abc123",
        )
        assert "svg" in html.lower()
        print("✓ Invite email HTML contains fox logo SVG")

    def test_contains_inviter_name(self):
        """Verify invite email contains the inviter's name."""
        from app.email_templates import render_invite_email
        _, text, html = render_invite_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            inviter_name="BobTheBuilder",
            server_name="Gaming Hub",
            invite_url="https://example.com/invite/abc123",
        )
        assert "BobTheBuilder" in text
        assert "BobTheBuilder" in html
        print("✓ Invite email contains inviter name 'BobTheBuilder'")

    def test_contains_server_name(self):
        """Verify invite email contains the server name."""
        from app.email_templates import render_invite_email
        _, text, html = render_invite_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            inviter_name="Alice",
            server_name="Awesome Gaming Server",
            invite_url="https://example.com/invite/abc123",
        )
        assert "Awesome Gaming Server" in text
        assert "Awesome Gaming Server" in html
        print("✓ Invite email contains server name 'Awesome Gaming Server'")

    def test_contains_accept_button(self):
        """Verify invite email contains accept invitation button."""
        from app.email_templates import render_invite_email
        _, _, html = render_invite_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            inviter_name="Alice",
            server_name="Gaming Hub",
            invite_url="https://example.com/invite/xyz789",
        )
        assert "Accept Invitation" in html
        assert "https://example.com/invite/xyz789" in html
        print("✓ Invite email contains 'Accept Invitation' button with correct URL")


class TestSecurityAlertEmail:
    """Test render_security_alert_email function."""

    def test_returns_valid_tuple(self):
        """Verify function returns (subject, text, html) tuple."""
        from app.email_templates import render_security_alert_email
        result = render_security_alert_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            alert_type="New login detected",
            details="Chrome on Windows, IP: 192.168.1.1",
        )
        assert isinstance(result, tuple)
        assert len(result) == 3
        subject, text, html = result
        assert isinstance(subject, str)
        assert isinstance(text, str)
        assert isinstance(html, str)
        print(f"✓ Security alert email returns valid tuple: subject='{subject[:50]}...'")

    def test_html_contains_mauntingstudios(self):
        """Verify HTML footer contains mauntingstudios branding."""
        from app.email_templates import render_security_alert_email
        _, _, html = render_security_alert_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            alert_type="New login detected",
            details="Chrome on Windows",
        )
        assert "mauntingstudios" in html
        print("✓ Security alert email HTML contains 'mauntingstudios'")

    def test_html_contains_fox_logo_svg(self):
        """Verify HTML contains fox logo SVG."""
        from app.email_templates import render_security_alert_email
        _, _, html = render_security_alert_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            alert_type="New login detected",
            details="Chrome on Windows",
        )
        assert "svg" in html.lower()
        print("✓ Security alert email HTML contains fox logo SVG")

    def test_contains_alert_type(self):
        """Verify security alert email contains the alert type."""
        from app.email_templates import render_security_alert_email
        subject, text, html = render_security_alert_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            alert_type="Password changed",
            details="Your password was changed.",
        )
        assert "Password changed" in subject
        assert "Password changed" in text
        assert "Password changed" in html
        print("✓ Security alert email contains alert type 'Password changed'")

    def test_contains_details(self):
        """Verify security alert email contains the details."""
        from app.email_templates import render_security_alert_email
        _, text, html = render_security_alert_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            alert_type="New login detected",
            details="Firefox on macOS, IP: 10.0.0.5, Location: Berlin",
        )
        assert "Firefox on macOS" in text
        assert "Firefox on macOS" in html
        assert "10.0.0.5" in text
        assert "10.0.0.5" in html
        print("✓ Security alert email contains details")

    def test_optional_action_button_without_url(self):
        """Verify security alert works without action_url (no button)."""
        from app.email_templates import render_security_alert_email
        _, _, html = render_security_alert_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            alert_type="2FA enabled",
            details="Two-factor authentication was enabled.",
            action_url="",
        )
        assert "Review Account Security" not in html
        print("✓ Security alert without action_url has no button")

    def test_optional_action_button_with_url(self):
        """Verify security alert includes button when action_url is provided."""
        from app.email_templates import render_security_alert_email
        _, _, html = render_security_alert_email(
            app_name="Singra Vox",
            instance_name="Test Instance",
            alert_type="Suspicious activity",
            details="Multiple failed login attempts.",
            action_url="https://example.com/security",
        )
        assert "Review Account Security" in html
        assert "https://example.com/security" in html
        print("✓ Security alert with action_url includes button")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
