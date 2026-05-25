from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from .. import models, schemas, auth
from ..database import get_db
from ..analytics import log_activity, increment_login_count, update_user_count


router = APIRouter(prefix="/auth", tags=["Authentication"])



@router.post("/register", response_model=schemas.Token, status_code=status.HTTP_201_CREATED)
def register_user(
    user_data: schemas.UserRegister,
    db: Session = Depends(get_db)
):
    """
    Register a new user
    
    - Creates a new user account
    - Automatically creates a personal workspace for the user
    - Returns JWT token for immediate login
    """
    # Check if email already exists
    existing_email = db.query(models.User).filter(models.User.email == user_data.email).first()
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if username already exists
    existing_username = db.query(models.User).filter(models.User.username == user_data.username).first()
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Create new user
    hashed_password = auth.get_password_hash(user_data.password)
    new_user = models.User(
        email=user_data.email,
        username=user_data.username,
        hashed_password=hashed_password,
        full_name=user_data.full_name
    )
    
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    
    # Create personal workspace for the user
    personal_workspace = models.Client(
        name=f"{user_data.username}'s Workspace"
    )
    db.add(personal_workspace)
    db.commit()
    db.refresh(personal_workspace)
    
    # Add user as OWNER of their personal workspace
    membership = models.ClientMembership(
        user_id=new_user.id,
        client_id=personal_workspace.id,
        role=models.UserRole.OWNER
    )
    db.add(membership)
    db.commit()
    
    # Log registration activity
    log_activity(
        db=db,
        activity_type=models.ActivityType.USER_REGISTER,
        user_id=new_user.id,
        client_id=personal_workspace.id,
        extra_data={"username": new_user.username, "email": new_user.email}
    )
    update_user_count(db, personal_workspace.id)
    
    # Generate JWT token
    access_token = auth.create_access_token(data={"user_id": new_user.id})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": new_user
    }



@router.post("/login", response_model=schemas.Token)
def login_user(
    credentials: schemas.UserLogin,
    db: Session = Depends(get_db)
):
    """
    Login with username and password
    
    - Validates credentials
    - Returns JWT token for authenticated requests
    """
    # Find user by username
    user = db.query(models.User).filter(models.User.username == credentials.username).first()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verify password
    if not auth.verify_password(credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Check if user is active
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user account"
        )
    
    # Log login activity
    membership = db.query(models.ClientMembership).filter(
        models.ClientMembership.user_id == user.id
    ).first()
    
    if membership:
        log_activity(
            db=db,
            activity_type=models.ActivityType.USER_LOGIN,
            user_id=user.id,
            client_id=membership.client_id,
            extra_data={"username": user.username}
        )
        increment_login_count(db, membership.client_id)
    
    # Generate JWT token
    access_token = auth.create_access_token(data={"user_id": user.id})
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }



@router.get("/me", response_model=schemas.UserResponse)
def get_current_user_info(
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Get information about the currently authenticated user
    
    - Requires valid JWT token in Authorization header
    """
    return current_user



@router.get("/me/workspaces", response_model=list[schemas.MembershipResponse])
def get_user_workspaces(
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """
    Get all workspaces (clients) the current user has access to
    
    - Returns list of workspaces with user's role in each
    """
    memberships = db.query(models.ClientMembership).filter(
        models.ClientMembership.user_id == current_user.id
    ).all()
    
    result = []
    for membership in memberships:
        client = db.query(models.Client).filter(models.Client.id == membership.client_id).first()
        result.append({
            "id": membership.id,
            "client_id": membership.client_id,
            "client_name": client.name if client else "Unknown",
            "role": membership.role,
            "joined_at": membership.joined_at
        })
    
    return result
