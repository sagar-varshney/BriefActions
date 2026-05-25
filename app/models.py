from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base
import enum


# === USER ROLES ===

class UserRole(str, enum.Enum):
    OWNER = "owner"      # Created the workspace, full control
    ADMIN = "admin"      # Can manage users and all documents
    EDITOR = "editor"    # Can upload/edit documents
    VIEWER = "viewer"    # Read-only access


# === ACTIVITY TYPES ===

class ActivityType(str, enum.Enum):
    """Types of activities to track"""
    DOCUMENT_UPLOAD = "document_upload"
    DOCUMENT_INDEX = "document_index"
    DOCUMENT_DELETE = "document_delete"
    RAG_QUERY = "rag_query"
    USER_LOGIN = "user_login"
    USER_REGISTER = "user_register"
    ACCESS_GRANT = "access_grant"


# === USER MODEL ===

class User(Base):
    """
    Represents a user in the system
    Users can belong to multiple clients with different roles
    """
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    memberships = relationship("ClientMembership", back_populates="user")


# === CLIENT MODEL ===

class Client(Base):
    """
    Represents a client/workspace in the system
    All documents and conversations are scoped to a client
    """
    __tablename__ = "clients"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    documents = relationship("Document", back_populates="client")
    access_grants = relationship("AccessGrant", back_populates="client")
    members = relationship("ClientMembership", back_populates="client")
    usage_stats = relationship("UsageStats", back_populates="client", uselist=False)


# === CLIENT MEMBERSHIP MODEL ===

class ClientMembership(Base):
    """
    Links users to clients with specific roles
    A user can be part of multiple clients with different roles
    """
    __tablename__ = "client_memberships"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.VIEWER)
    joined_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    user = relationship("User", back_populates="memberships")
    client = relationship("Client", back_populates="members")


# === DOCUMENT MODEL ===

class Document(Base):
    """
    Represents a document uploaded for a client
    Can be public or restricted (requires manual unlock)
    """
    __tablename__ = "documents"
    
    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    title = Column(String, nullable=False)
    file_path = Column(String, nullable=False)  # Path to actual file
    doc_type = Column(String)  # pdf, txt, docx, etc.
    is_restricted = Column(Boolean, default=False)  # Requires unlock for RAG access
    is_indexed = Column(Boolean, default=False)  # Has been embedded for RAG
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    client = relationship("Client", back_populates="documents")
    access_grants = relationship("AccessGrant", back_populates="document")


# === ACCESS GRANT MODEL ===

class AccessGrant(Base):
    """
    Tracks when a user manually unlocks a restricted document
    Allows view-only access without adding to RAG context
    """
    __tablename__ = "access_grants"
    
    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    granted_at = Column(DateTime, default=datetime.utcnow)
    granted_by = Column(String, default="user")  # Could be username in real app
    
    # Relationships
    client = relationship("Client", back_populates="access_grants")
    document = relationship("Document", back_populates="access_grants")


# === ANALYTICS MODELS ===

class ActivityLog(Base):
    """
    Tracks all user activities for analytics
    Every action creates a log entry
    """
    __tablename__ = "activity_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    activity_type = Column(Enum(ActivityType), nullable=False)
    
    # Details about the activity
    resource_id = Column(Integer, nullable=True)  # document_id, etc.
    resource_type = Column(String, nullable=True)  # "document", "query", etc.
    extra_data = Column(Text, nullable=True)  # JSON string for extra data  ← RENAMED
    
    # Tracking
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    ip_address = Column(String, nullable=True)
    
    # Relationships
    user = relationship("User")
    client = relationship("Client")


class UsageStats(Base):
    """
    Aggregated usage statistics per workspace
    Updated in real-time when activities happen
    """
    __tablename__ = "usage_stats"
    
    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False, unique=True)
    
    # Storage metrics (in bytes)
    total_storage_bytes = Column(Integer, default=0)
    document_count = Column(Integer, default=0)
    
    # Activity metrics
    total_rag_queries = Column(Integer, default=0)
    total_uploads = Column(Integer, default=0)
    total_logins = Column(Integer, default=0)
    
    # User metrics
    total_users = Column(Integer, default=0)
    
    # Timestamps
    last_activity_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    client = relationship("Client", back_populates="usage_stats")
