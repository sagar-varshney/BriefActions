from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict, Any
from datetime import datetime, timedelta
from .. import models, auth
from ..database import get_db
from ..analytics import get_workspace_analytics


router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/clients/{client_id}/overview")
def get_client_analytics(
    client_id: int,
    db: Session = Depends(get_db)
):
    """
    Get comprehensive analytics overview for a workspace
    
    Returns:
    - Storage usage
    - Document count
    - Query count
    - Upload count
    - Login count
    - User count
    - Recent activity logs
    """
    # Verify client exists
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Get analytics data
    analytics = get_workspace_analytics(db, client_id)
    
    return analytics


@router.get("/clients/{client_id}/activity-log")
def get_activity_log(
    client_id: int,
    limit: int = 50,
    activity_type: str = None,
    db: Session = Depends(get_db)
):
    """
    Get detailed activity log for a workspace
    
    Query params:
    - limit: Number of activities to return (default 50, max 500)
    - activity_type: Filter by specific activity type (optional)
    
    Returns list of all activities with timestamps
    """
    # Verify client exists
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Limit check
    if limit > 500:
        limit = 500
    
    # Build query
    query = db.query(models.ActivityLog).filter(
        models.ActivityLog.client_id == client_id
    )
    
    # Filter by activity type if provided
    if activity_type:
        try:
            activity_enum = models.ActivityType(activity_type)
            query = query.filter(models.ActivityLog.activity_type == activity_enum)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid activity_type. Valid types: {[e.value for e in models.ActivityType]}"
            )
    
    # Get activities
    activities = query.order_by(
        models.ActivityLog.timestamp.desc()
    ).limit(limit).all()
    
    # Format response
    result = []
    for activity in activities:
        user = db.query(models.User).filter(models.User.id == activity.user_id).first()
        
        result.append({
            "id": activity.id,
            "activity_type": activity.activity_type.value,
            "user_id": activity.user_id,
            "username": user.username if user else "Unknown",
            "resource_id": activity.resource_id,
            "resource_type": activity.resource_type,
            "extra_data": activity.extra_data,
            "timestamp": activity.timestamp.isoformat(),
            "ip_address": activity.ip_address
        })
    
    return {
        "client_id": client_id,
        "total_activities": len(result),
        "activities": result
    }


@router.get("/clients/{client_id}/stats/storage")
def get_storage_breakdown(
    client_id: int,
    db: Session = Depends(get_db)
):
    """
    Get detailed storage breakdown by document
    
    Shows which documents are taking up the most space
    """
    # Verify client exists
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Get all documents with their sizes
    documents = db.query(models.Document).filter(
        models.Document.client_id == client_id
    ).all()
    
    import os
    storage_breakdown = []
    total_storage = 0
    
    for doc in documents:
        if os.path.exists(doc.file_path):
            file_size = os.path.getsize(doc.file_path)
            total_storage += file_size
            
            storage_breakdown.append({
                "document_id": doc.id,
                "title": doc.title,
                "doc_type": doc.doc_type,
                "size_bytes": file_size,
                "size_mb": round(file_size / (1024 * 1024), 2),
                "is_indexed": doc.is_indexed,
                "uploaded_at": doc.uploaded_at.isoformat()
            })
    
    # Sort by size (largest first)
    storage_breakdown.sort(key=lambda x: x['size_bytes'], reverse=True)
    
    return {
        "client_id": client_id,
        "total_storage_bytes": total_storage,
        "total_storage_mb": round(total_storage / (1024 * 1024), 2),
        "total_storage_gb": round(total_storage / (1024 * 1024 * 1024), 2),
        "document_count": len(documents),
        "documents": storage_breakdown
    }


@router.get("/clients/{client_id}/stats/queries")
def get_query_stats(
    client_id: int,
    days: int = 7,
    db: Session = Depends(get_db)
):
    """
    Get query statistics for the last N days
    
    Shows:
    - Total queries
    - Queries per day
    - Most common query topics
    """
    # Verify client exists
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Calculate date range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)
    
    # Get all query activities in date range
    queries = db.query(models.ActivityLog).filter(
        models.ActivityLog.client_id == client_id,
        models.ActivityLog.activity_type == models.ActivityType.RAG_QUERY,
        models.ActivityLog.timestamp >= start_date
    ).all()
    
    # Group by date
    queries_by_date = {}
    for query in queries:
        date_str = query.timestamp.date().isoformat()
        queries_by_date[date_str] = queries_by_date.get(date_str, 0) + 1
    
    return {
        "client_id": client_id,
        "date_range": {
            "start": start_date.isoformat(),
            "end": end_date.isoformat(),
            "days": days
        },
        "total_queries": len(queries),
        "average_per_day": round(len(queries) / days, 2) if days > 0 else 0,
        "queries_by_date": queries_by_date,
        "recent_queries": [
            {
                "timestamp": q.timestamp.isoformat(),
                "user_id": q.user_id
            }
            for q in queries[:10]
        ]
    }


@router.get("/clients/{client_id}/stats/users")
def get_user_activity_stats(
    client_id: int,
    db: Session = Depends(get_db)
):
    """
    Get user activity statistics for a workspace
    
    Shows which users are most active
    """
    # Verify client exists
    client = db.query(models.Client).filter(models.Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Get all activities grouped by user
    activities = db.query(
        models.ActivityLog.user_id,
        func.count(models.ActivityLog.id).label('activity_count')
    ).filter(
        models.ActivityLog.client_id == client_id
    ).group_by(models.ActivityLog.user_id).all()
    
    # Get user details
    user_stats = []
    for user_id, count in activities:
        if user_id:
            user = db.query(models.User).filter(models.User.id == user_id).first()
            membership = db.query(models.ClientMembership).filter(
                models.ClientMembership.user_id == user_id,
                models.ClientMembership.client_id == client_id
            ).first()
            
            user_stats.append({
                "user_id": user_id,
                "username": user.username if user else "Unknown",
                "email": user.email if user else "Unknown",
                "role": membership.role.value if membership else "Unknown",
                "total_activities": count
            })
    
    # Sort by activity count
    user_stats.sort(key=lambda x: x['total_activities'], reverse=True)
    
    return {
        "client_id": client_id,
        "total_users": len(user_stats),
        "users": user_stats
    }


@router.get("/global/overview")
def get_global_analytics(db: Session = Depends(get_db)):
    """
    Get system-wide analytics across all workspaces
    
    Admin-level endpoint showing:
    - Total workspaces
    - Total users
    - Total documents
    - Total storage
    - Total queries
    """
    # Count totals
    total_clients = db.query(models.Client).count()
    total_users = db.query(models.User).count()
    total_documents = db.query(models.Document).count()
    total_activities = db.query(models.ActivityLog).count()
    
    # Get total storage across all workspaces
    all_stats = db.query(models.UsageStats).all()
    total_storage = sum(stat.total_storage_bytes for stat in all_stats)
    total_queries = sum(stat.total_rag_queries for stat in all_stats)
    
    # Get most active workspaces
    active_workspaces = db.query(
        models.UsageStats.client_id,
        models.UsageStats.total_rag_queries
    ).order_by(models.UsageStats.total_rag_queries.desc()).limit(5).all()
    
    workspace_rankings = []
    for client_id, query_count in active_workspaces:
        client = db.query(models.Client).filter(models.Client.id == client_id).first()
        workspace_rankings.append({
            "client_id": client_id,
            "client_name": client.name if client else "Unknown",
            "total_queries": query_count
        })
    
    return {
        "system_overview": {
            "total_workspaces": total_clients,
            "total_users": total_users,
            "total_documents": total_documents,
            "total_activities": total_activities
        },
        "storage": {
            "total_bytes": total_storage,
            "total_mb": round(total_storage / (1024 * 1024), 2),
            "total_gb": round(total_storage / (1024 * 1024 * 1024), 2)
        },
        "queries": {
            "total_queries": total_queries
        },
        "top_workspaces": workspace_rankings
    }
