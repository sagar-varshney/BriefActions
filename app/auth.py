from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from . import models
from .database import get_db

# JWT Configuration
SECRET_KEY = "your-secret-key-change-this-in-production-use-openssl-rand-hex-32"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# Password hashing
pwd_context = CryptContext(schemes=["argon2" , "bcrypt"], deprecated="auto")

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """Hash a password for storage"""
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token
    
    Args:
        data: Dictionary to encode in the token (usually user_id, username)
        expires_delta: Optional custom expiration time
    
    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    
    return encoded_jwt


def decode_access_token(token: str) -> dict:
    """
    Decode and validate a JWT token
    
    Args:
        token: JWT token string
    
    Returns:
        Decoded token data
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise credentials_exception


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> models.User:
    """
    Dependency to get the current authenticated user from JWT token
    
    Args:
        token: JWT token from request header
        db: Database session
    
    Returns:
        User object
    
    Raises:
        HTTPException: If user not found or token invalid
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    payload = decode_access_token(token)
    user_id: int = payload.get("user_id")
    
    if user_id is None:
        raise credentials_exception
    
    user = db.query(models.User).filter(models.User.id == user_id).first()
    
    if user is None:
        raise credentials_exception
    
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    
    return user


def verify_client_access(
    user: models.User,
    client_id: int,
    db: Session,
    required_role: Optional[models.UserRole] = None
) -> models.ClientMembership:
    """
    Verify that a user has access to a specific client workspace
    
    Args:
        user: Authenticated user
        client_id: Client/workspace ID to check access for
        db: Database session
        required_role: Optional minimum role required (e.g., ADMIN)
    
    Returns:
        ClientMembership object if access is granted
    
    Raises:
        HTTPException: If user doesn't have access or insufficient permissions
    """
    # Check if user is a member of this client
    membership = db.query(models.ClientMembership).filter(
        models.ClientMembership.user_id == user.id,
        models.ClientMembership.client_id == client_id
    ).first()
    
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You don't have access to this workspace"
        )
    
    # Check role if required
    if required_role:
        role_hierarchy = {
            models.UserRole.VIEWER: 1,
            models.UserRole.EDITOR: 2,
            models.UserRole.ADMIN: 3,
            models.UserRole.OWNER: 4
        }
        
        if role_hierarchy.get(membership.role, 0) < role_hierarchy.get(required_role, 0):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required role: {required_role.value}"
            )
    
    return membership
