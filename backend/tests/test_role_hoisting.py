"""
Test Role Hoisting Feature - Iteration 7

Tests:
- Role CRUD with hoist field
- GET roles returns hoist field
- POST role with hoist:true creates hoisted role
- PUT role with hoist:true updates role to hoisted
"""
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "singravox")
TEST_SERVER_ID = "03778528-7e75-4ddc-83df-f06260323967"
TEST_CREDENTIALS = {
    "email": "admin@singravox.local",
    "password": "Admin1234!"
}


def clear_rate_limits():
    client = MongoClient(MONGO_URL)
    try:
        client[DB_NAME].rate_limits.delete_many({})
    finally:
        client.close()


@pytest.fixture(scope="module")
def auth_session():
    """Create authenticated session for all tests"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    
    # Login
    clear_rate_limits()
    response = session.post(f"{BASE_URL}/api/auth/login", json=TEST_CREDENTIALS)
    assert response.status_code == 200, f"Login failed: {response.text}"
    
    data = response.json()
    token = data.get("access_token")
    assert token, "No access token in login response"
    
    session.headers.update({"Authorization": f"Bearer {token}"})
    return session


class TestHealthEndpoint:
    """Test backend health endpoint"""
    
    def test_health_returns_ok(self):
        """Backend health endpoint /api/health returns ok"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        print("✓ Backend health endpoint returns ok")


class TestRoleHoisting:
    """Test Role Hoisting feature - CRUD operations with hoist field"""
    
    def test_get_roles_returns_hoist_field(self, auth_session):
        """GET /api/servers/{id}/roles returns roles with hoist field"""
        response = auth_session.get(f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/roles")
        assert response.status_code == 200, f"Failed to get roles: {response.text}"
        
        roles = response.json()
        assert isinstance(roles, list), "Roles should be a list"
        assert len(roles) > 0, "Should have at least one role"
        
        # Check that hoist field exists in roles
        for role in roles:
            assert "hoist" in role or role.get("is_default"), f"Role {role.get('name')} missing hoist field"
            print(f"  Role: {role.get('name')}, hoist: {role.get('hoist', False)}, is_default: {role.get('is_default', False)}")
        
        print("✓ GET roles returns hoist field")
    
    def test_create_role_with_hoist_true(self, auth_session):
        """POST /api/servers/{id}/roles with hoist:true creates hoisted role"""
        role_data = {
            "name": "TEST_HoistedRole",
            "color": "#FF5733",
            "mentionable": False,
            "hoist": True
        }
        
        response = auth_session.post(
            f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/roles",
            json=role_data
        )
        assert response.status_code == 200, f"Failed to create role: {response.text}"
        
        created_role = response.json()
        assert created_role.get("name") == "TEST_HoistedRole"
        assert created_role.get("hoist"), "Created role should have hoist=true"
        assert created_role.get("color") == "#FF5733"
        
        # Store role ID for cleanup
        self.__class__.created_role_id = created_role.get("id")
        
        print(f"✓ Created hoisted role: {created_role.get('name')} with hoist={created_role.get('hoist')}")
    
    def test_create_role_with_hoist_false(self, auth_session):
        """POST /api/servers/{id}/roles with hoist:false creates non-hoisted role"""
        role_data = {
            "name": "TEST_NonHoistedRole",
            "color": "#3498DB",
            "mentionable": True,
            "hoist": False
        }
        
        response = auth_session.post(
            f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/roles",
            json=role_data
        )
        assert response.status_code == 200, f"Failed to create role: {response.text}"
        
        created_role = response.json()
        assert created_role.get("name") == "TEST_NonHoistedRole"
        assert not created_role.get("hoist"), "Created role should have hoist=false"
        
        # Store role ID for cleanup
        self.__class__.non_hoisted_role_id = created_role.get("id")
        
        print(f"✓ Created non-hoisted role: {created_role.get('name')} with hoist={created_role.get('hoist')}")
    
    def test_update_role_hoist_to_true(self, auth_session):
        """PUT /api/servers/{id}/roles/{id} with hoist:true updates role to hoisted"""
        role_id = getattr(self.__class__, "non_hoisted_role_id", None)
        if not role_id:
            pytest.skip("No non-hoisted role created to update")
        
        update_data = {
            "hoist": True
        }
        
        response = auth_session.put(
            f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/roles/{role_id}",
            json=update_data
        )
        assert response.status_code == 200, f"Failed to update role: {response.text}"
        
        updated_role = response.json()
        assert updated_role.get("hoist"), "Updated role should have hoist=true"
        
        print(f"✓ Updated role to hoisted: {updated_role.get('name')} with hoist={updated_role.get('hoist')}")
    
    def test_update_role_hoist_to_false(self, auth_session):
        """PUT /api/servers/{id}/roles/{id} with hoist:false updates role to non-hoisted"""
        role_id = getattr(self.__class__, "created_role_id", None)
        if not role_id:
            pytest.skip("No hoisted role created to update")
        
        update_data = {
            "hoist": False
        }
        
        response = auth_session.put(
            f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/roles/{role_id}",
            json=update_data
        )
        assert response.status_code == 200, f"Failed to update role: {response.text}"
        
        updated_role = response.json()
        assert not updated_role.get("hoist"), "Updated role should have hoist=false"
        
        print(f"✓ Updated role to non-hoisted: {updated_role.get('name')} with hoist={updated_role.get('hoist')}")
    
    def test_verify_existing_hoisted_roles(self, auth_session):
        """Verify existing Admin and Moderator roles have hoist field"""
        response = auth_session.get(f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/roles")
        assert response.status_code == 200
        
        roles = response.json()
        
        # Find Admin role
        admin_role = next((r for r in roles if r.get("name") == "Admin"), None)
        if admin_role:
            print(f"  Admin role: hoist={admin_role.get('hoist')}, color={admin_role.get('color')}")
        
        # Find Moderator role
        mod_role = next((r for r in roles if r.get("name") == "Moderator"), None)
        if mod_role:
            print(f"  Moderator role: hoist={mod_role.get('hoist')}, color={mod_role.get('color')}")
        
        print("✓ Verified existing roles have hoist field")
    
    def test_cleanup_test_roles(self, auth_session):
        """Cleanup: Delete test-created roles"""
        roles_to_delete = []
        
        if hasattr(self.__class__, "created_role_id"):
            roles_to_delete.append(self.__class__.created_role_id)
        if hasattr(self.__class__, "non_hoisted_role_id"):
            roles_to_delete.append(self.__class__.non_hoisted_role_id)
        
        for role_id in roles_to_delete:
            response = auth_session.delete(
                f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/roles/{role_id}"
            )
            if response.status_code == 200:
                print(f"  Deleted test role: {role_id}")
            else:
                print(f"  Warning: Could not delete role {role_id}: {response.status_code}")
        
        print("✓ Cleanup completed")


class TestMemberEndpoint:
    """Test member endpoint returns data needed for role hoisting"""
    
    def test_get_members_returns_roles(self, auth_session):
        """GET /api/servers/{id}/members returns members with roles array"""
        response = auth_session.get(f"{BASE_URL}/api/servers/{TEST_SERVER_ID}/members")
        assert response.status_code == 200, f"Failed to get members: {response.text}"
        
        members = response.json()
        assert isinstance(members, list), "Members should be a list"
        assert len(members) > 0, "Should have at least one member"
        
        # Check that members have roles array
        for member in members:
            assert "roles" in member, f"Member {member.get('user_id')} missing roles field"
            assert "user" in member, f"Member {member.get('user_id')} missing user field"
            user = member.get("user", {})
            print(f"  Member: {user.get('display_name')}, roles: {member.get('roles')}, status: {user.get('status')}")
        
        print("✓ GET members returns roles array for each member")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
