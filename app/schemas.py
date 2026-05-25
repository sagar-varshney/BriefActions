from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


# === CLIENT SCHEMAS ===

class ClientCreate(BaseModel):
    """Schema for creating a new client"""
    name: str


class ClientOut(BaseModel):
    """Schema for returning client data"""
    id: int
    name: str
    created_at: datetime
    
    class Config:
        from_attributes = True  # Allows conversion from SQLAlchemy models


# === DOCUMENT SCHEMAS ===

class DocumentCreate(BaseModel):
    """Schema for creating/uploading a document"""
    title: str
    doc_type: Optional[str] = None
    is_restricted: bool = False


class DocumentOut(BaseModel):
    """Schema for returning document data"""
    id: int
    client_id: int
    title: str
    file_path: str
    doc_type: Optional[str] = None
    is_restricted: bool
    is_indexed: bool
    uploaded_at: datetime
    
    class Config:
        from_attributes = True


# === ACCESS GRANT SCHEMAS ===

class AccessGrantCreate(BaseModel):
    """Schema for unlocking a restricted document"""
    granted_by: Optional[str] = "user"


class AccessGrantOut(BaseModel):
    """Schema for returning access grant data"""
    id: int
    client_id: int
    document_id: int
    granted_at: datetime
    granted_by: str
    
    class Config:
        from_attributes = True


# === RESPONSE SCHEMAS ===

class DocumentUnlockResponse(BaseModel):
    """Response after unlocking a document"""
    message: str
    document_id: int
    access_granted: bool
    access_grant: AccessGrantOut


# ========== USER SCHEMAS ==========

class UserRegister(BaseModel):
    """Schema for user registration"""
    email: EmailStr
    username: str
    password: str
    full_name: Optional[str] = None


class UserLogin(BaseModel):
    """Schema for user login"""
    username: str
    password: str


class UserResponse(BaseModel):
    """Schema for user data in responses"""
    id: int
    email: str
    username: str
    full_name: Optional[str]
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


class Token(BaseModel):
    """Schema for JWT token response"""
    access_token: str
    token_type: str
    user: UserResponse


# ========== CLIENT MEMBERSHIP SCHEMAS ==========

class MembershipResponse(BaseModel):
    """Schema for client membership data"""
    id: int
    client_id: int
    client_name: str
    role: str
    joined_at: datetime
    
    class Config:
        from_attributes = True


class UserWithMemberships(UserResponse):
    """User data with their client memberships"""
    workspaces: List[MembershipResponse] = []
