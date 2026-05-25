from sqlalchemy.orm import Session
from . import models
from datetime import datetime
import json
from typing import Optional, Dict, Any


def log_activity(
    db: Session,
    activity_type: models.ActivityType,
    user_id: Optional[int] = None,
    client_id: Optional[int] = None,
    resource_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    extra_data: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None
):
    """
    Log an activity to the activity_logs table
    
    Args:
        db: Database session
        activity_type: Type of activity (from ActivityType enum)
        user_id: User who performed the activity
        client_id: Workspace where activity occurred
        resource_id: ID of resource (document_id, etc.)
        resource_type: Type of resource ("document", "query", etc.)
        extra_data: Additional data as dictionary (will be JSON serialized)
        ip_address: User's IP address
    """
    activity = models.ActivityLog(
        user_id=user_id,
        client_id=client_id,
        activity_type=activity_type,
        resource_id=resource_id,
        resource_type=resource_type,
        extra_data=json.dumps(extra_data) if extra_data else None,
        ip_address=ip_address,
        timestamp=datetime.utcnow()
    )
    
    db.add(activity)
    db.commit()
    
    print(f"📊 Activity logged: {activity_type.value} - User: {user_id}, Client: {client_id}")


def get_or_create_usage_stats(db: Session, client_id: int) -> models.UsageStats:
    """
    Get existing usage stats for a client or create new ones
    
    Args:
        db: Database session
        client_id: Client/workspace ID
    
    Returns:
        UsageStats object
    """
    stats = db.query(models.UsageStats).filter(
        models.UsageStats.client_id == client_id
    ).first()
    
    if not stats:
        stats = models.UsageStats(client_id=client_id)
        db.add(stats)
        db.commit()
        db.refresh(stats)
    
    return stats


def update_storage_stats(db: Session, client_id: int, file_size_bytes: int, increment_docs: bool = True):
    """
    Update storage statistics for a workspace
    
    Args:
        db: Database session
        client_id: Client/workspace ID
        file_size_bytes: Size of file in bytes (positive for upload, negative for delete)
        increment_docs: Whether to increment document count
    """
    stats = get_or_create_usage_stats(db, client_id)
    
    stats.total_storage_bytes += file_size_bytes
    if increment_docs:
        stats.document_count += 1
    
    stats.last_activity_at = datetime.utcnow()
    stats.updated_at = datetime.utcnow()
    
    db.commit()
    
    print(f"💾 Storage updated: Client {client_id} - {stats.total_storage_bytes} bytes, {stats.document_count} docs")


def increment_query_count(db: Session, client_id: int):
    """
    Increment RAG query count for a workspace
    
    Args:
        db: Database session
        client_id: Client/workspace ID
    """
    stats = get_or_create_usage_stats(db, client_id)
    
    stats.total_rag_queries += 1
    stats.last_activity_at = datetime.utcnow()
    stats.updated_at = datetime.utcnow()
    
    db.commit()
    
    print(f"🔍 Query count: Client {client_id} - {stats.total_rag_queries} total queries")


def increment_upload_count(db: Session, client_id: int):
    """
    Increment upload count for a workspace
    
    Args:
        db: Database session
        client_id: Client/workspace ID
    """
    stats = get_or_create_usage_stats(db, client_id)
    
    stats.total_uploads += 1
    stats.last_activity_at = datetime.utcnow()
    stats.updated_at = datetime.utcnow()
    
    db.commit()


def increment_login_count(db: Session, client_id: int):
    """
    Increment login count for a workspace
    
    Args:
        db: Database session
        client_id: Client/workspace ID
    """
    stats = get_or_create_usage_stats(db, client_id)
    
    stats.total_logins += 1
    stats.last_activity_at = datetime.utcnow()
    stats.updated_at = datetime.utcnow()
    
    db.commit()


def update_user_count(db: Session, client_id: int):
    """
    Update total user count for a workspace
    Counts all members in the workspace
    
    Args:
        db: Database session
        client_id: Client/workspace ID
    """
    stats = get_or_create_usage_stats(db, client_id)
    
    # Count total members
    user_count = db.query(models.ClientMembership).filter(
        models.ClientMembership.client_id == client_id
    ).count()
    
    stats.total_users = user_count
    stats.updated_at = datetime.utcnow()
    
    db.commit()


def get_workspace_analytics(db: Session, client_id: int) -> Dict[str, Any]:
    """
    Get comprehensive analytics for a workspace
    
    Args:
        db: Database session
        client_id: Client/workspace ID
    
    Returns:
        Dictionary with analytics data
    """
    stats = get_or_create_usage_stats(db, client_id)
    
    # Get recent activity (last 10 activities)
    recent_activities = db.query(models.ActivityLog).filter(
        models.ActivityLog.client_id == client_id
    ).order_by(models.ActivityLog.timestamp.desc()).limit(10).all()
    
    # Calculate storage in MB and GB
    storage_mb = stats.total_storage_bytes / (1024 * 1024)
    storage_gb = stats.total_storage_bytes / (1024 * 1024 * 1024)
    
    return {
        "client_id": client_id,
        "storage": {
            "bytes": stats.total_storage_bytes,
            "mb": round(storage_mb, 2),
            "gb": round(storage_gb, 2)
        },
        "documents": stats.document_count,
        "queries": stats.total_rag_queries,
        "uploads": stats.total_uploads,
        "logins": stats.total_logins,
        "users": stats.total_users,
        "last_activity": stats.last_activity_at.isoformat() if stats.last_activity_at else None,
        "recent_activities": [
            {
                "type": activity.activity_type.value,
                "timestamp": activity.timestamp.isoformat(),
                "user_id": activity.user_id,
                "resource_type": activity.resource_type
            }
            for activity in recent_activities
        ]
    }
