from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Any
from pydantic import BaseModel
import shutil
import os
from pathlib import Path


from .database import engine, get_db, Base
from .models import Client, Document, AccessGrant
from .schemas import (
    ClientCreate, ClientOut,
    DocumentCreate, DocumentOut,
    AccessGrantCreate, AccessGrantOut,
    DocumentUnlockResponse
)
from .rag_service import index_document, search_documents, delete_document_from_index
from .llm_service import generate_answer
from .routers import auth, analytics_router
from .analytics import (
    log_activity,
    update_storage_stats,
    increment_query_count,
    increment_upload_count
)
from . import models


# Initialize FastAPI app
app = FastAPI(
    title="RAG Client Center API",
    description="Client-scoped document management with RAG capabilities",
    version="1.0.0"
)

# Include routers
app.include_router(auth.router)
app.include_router(analytics_router.router)


# Storage path for uploaded documents
STORAGE_PATH = Path(__file__).parent.parent / "storage" / "documents"
STORAGE_PATH.mkdir(parents=True, exist_ok=True)



# === STARTUP EVENT ===


@app.on_event("startup")
def startup():
    """Create all database tables on startup"""
    Base.metadata.create_all(bind=engine)
    print("✅ Database initialized successfully!")



# === HEALTH CHECK ===


@app.get("/health")
def health_check():
    """Simple health check endpoint"""
    return {"status": "ok", "service": "RAG Client Center"}



# === CLIENT ENDPOINTS ===


@app.post("/clients", response_model=ClientOut, status_code=201)
def create_client(client: ClientCreate, db: Session = Depends(get_db)):
    """
    Create a new client
    
    Example:
    POST /clients
    {"name": "Acme Corp"}
    """
    # Check if client already exists
    existing = db.query(Client).filter(Client.name == client.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Client already exists")
    
    # Create new client
    new_client = Client(name=client.name)
    db.add(new_client)
    db.commit()
    db.refresh(new_client)
    
    return new_client



@app.get("/clients", response_model=List[ClientOut])
def list_clients(db: Session = Depends(get_db)):
    """Get all clients"""
    clients = db.query(Client).order_by(Client.created_at.desc()).all()
    return clients



@app.get("/clients/{client_id}", response_model=ClientOut)
def get_client(client_id: int, db: Session = Depends(get_db)):
    """Get a specific client by ID"""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client



# === DOCUMENT ENDPOINTS ===


@app.post("/clients/{client_id}/documents", response_model=DocumentOut, status_code=201)
async def upload_document(
    client_id: int,
    file: UploadFile = File(...),
    is_restricted: bool = False,
    db: Session = Depends(get_db)
):
    """
    Upload a document for a specific client
    
    Example:
    POST /clients/1/documents
    Form Data:
    - file: [select file]
    - is_restricted: false
    """
    # Check if client exists
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Create client-specific folder
    client_folder = STORAGE_PATH / f"client_{client_id}"
    client_folder.mkdir(exist_ok=True)
    
    # Save file
    file_path = client_folder / file.filename
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Get file extension
    doc_type = file.filename.split(".")[-1] if "." in file.filename else "unknown"
    
    # Create database record
    new_doc = Document(
        client_id=client_id,
        title=file.filename,
        file_path=str(file_path),
        doc_type=doc_type,
        is_restricted=is_restricted,
        is_indexed=False
    )
    db.add(new_doc)
    db.commit()
    db.refresh(new_doc)
    
    # Log upload activity
    file_size = os.path.getsize(file_path)
    
    log_activity(
        db=db,
        activity_type=models.ActivityType.DOCUMENT_UPLOAD,
        client_id=client_id,
        resource_id=new_doc.id,
        resource_type="document",
        extra_data={"filename": file.filename, "size_bytes": file_size}
    )
    update_storage_stats(db, client_id, file_size, increment_docs=True)
    increment_upload_count(db, client_id)
    
    return new_doc



@app.get("/clients/{client_id}/documents", response_model=List[DocumentOut])
def list_client_documents(client_id: int, db: Session = Depends(get_db)):
    """
    Get all documents for a specific client
    Shows which documents are restricted
    """
    # Check if client exists
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    documents = db.query(Document).filter(
        Document.client_id == client_id
    ).order_by(Document.uploaded_at.desc()).all()
    
    return documents



@app.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(document_id: int, db: Session = Depends(get_db)):
    """Get a specific document by ID"""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document



# === ACCESS CONTROL ENDPOINTS ===


@app.post("/documents/{document_id}/unlock", response_model=DocumentUnlockResponse)
def unlock_document(
    document_id: int,
    access_data: AccessGrantCreate,
    db: Session = Depends(get_db)
):
    """
    Manually unlock a restricted document for view-only access
    Does NOT add document to RAG context
    
    Example:
    POST /documents/5/unlock
    {"granted_by": "john@example.com"}
    """
    # Check if document exists
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Check if document is actually restricted
    if not document.is_restricted:
        raise HTTPException(
            status_code=400,
            detail="Document is not restricted, no unlock needed"
        )
    
    # Check if already unlocked
    existing_grant = db.query(AccessGrant).filter(
        AccessGrant.document_id == document_id
    ).first()
    
    if existing_grant:
        return DocumentUnlockResponse(
            message="Document was already unlocked",
            document_id=document_id,
            access_granted=True,
            access_grant=existing_grant
        )
    
    # Create access grant
    new_grant = AccessGrant(
        client_id=document.client_id,
        document_id=document_id,
        granted_by=access_data.granted_by
    )
    db.add(new_grant)
    db.commit()
    db.refresh(new_grant)
    
    # Log access grant activity
    log_activity(
        db=db,
        activity_type=models.ActivityType.ACCESS_GRANT,
        client_id=document.client_id,
        resource_id=document_id,
        resource_type="document",
        extra_data={"granted_by": access_data.granted_by}
    )
    
    return DocumentUnlockResponse(
        message="Document unlocked successfully",
        document_id=document_id,
        access_granted=True,
        access_grant=new_grant
    )



@app.get("/documents/{document_id}/access", response_model=List[AccessGrantOut])
def get_document_access_grants(document_id: int, db: Session = Depends(get_db)):
    """Get all access grants for a specific document"""
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    grants = db.query(AccessGrant).filter(
        AccessGrant.document_id == document_id
    ).all()
    
    return grants



@app.get("/clients/{client_id}/access-grants", response_model=List[AccessGrantOut])
def list_client_access_grants(client_id: int, db: Session = Depends(get_db)):
    """Get all access grants for a client"""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    grants = db.query(AccessGrant).filter(
        AccessGrant.client_id == client_id
    ).all()
    
    return grants



# === RAG SCHEMAS (defined inline) ===


class ChatRequest(BaseModel):
    """Schema for RAG chat request"""
    query: str
    top_k: int = 5



class ChatResponse(BaseModel):
    """Schema for RAG chat response"""
    query: str
    answer: str
    sources: List[Dict[str, Any]]
    documents_searched: int
    restricted_docs_excluded: int



# === RAG ENDPOINTS ===


@app.post("/documents/{document_id}/index")
def index_document_endpoint(document_id: int, db: Session = Depends(get_db)):
    """
    Manually index a document for RAG search
    Converts document to embeddings and stores in vector DB
    """
    # Get document
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Don't index restricted documents automatically
    if document.is_restricted:
        raise HTTPException(
            status_code=400,
            detail="Cannot index restricted documents. They must be unlocked first."
        )
    
    # Check if already indexed
    if document.is_indexed:
        return {
            "message": "Document already indexed",
            "document_id": document_id,
            "indexed": True
        }
    
    try:
        # Index the document
        num_chunks = index_document(
            document_id=document.id,
            client_id=document.client_id,
            file_path=document.file_path,
            title=document.title
        )
        
        # Update database
        document.is_indexed = True
        db.commit()
        
        # Log indexing activity
        log_activity(
            db=db,
            activity_type=models.ActivityType.DOCUMENT_INDEX,
            client_id=document.client_id,
            resource_id=document_id,
            resource_type="document",
            extra_data={"chunks_created": num_chunks}
        )
        
        return {
            "message": f"Document indexed successfully with {num_chunks} chunks",
            "document_id": document_id,
            "chunks_created": num_chunks,
            "indexed": True
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")



@app.delete("/documents/{document_id}/index")
def remove_document_from_index(document_id: int, db: Session = Depends(get_db)):
    """
    Remove a document from the RAG index
    """
    document = db.query(Document).filter(Document.id == document_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    if not document.is_indexed:
        return {
            "message": "Document is not indexed",
            "document_id": document_id
        }
    
    try:
        delete_document_from_index(document_id, document.client_id)
        
        # Update database
        document.is_indexed = False
        db.commit()
        
        # Log delete activity
        log_activity(
            db=db,
            activity_type=models.ActivityType.DOCUMENT_DELETE,
            client_id=document.client_id,
            resource_id=document_id,
            resource_type="document"
        )
        
        return {
            "message": "Document removed from index",
            "document_id": document_id,
            "indexed": False
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to remove from index: {str(e)}")



@app.post("/clients/{client_id}/chat", response_model=ChatResponse)
def rag_chat(
    client_id: int,
    chat_request: ChatRequest,
    db: Session = Depends(get_db)
):
    """
    Client-scoped RAG chat endpoint
    
    - Searches only documents belonging to this client
    - Excludes restricted documents (unless they have access grants)
    - Returns answer with source citations
    
    Example:
    POST /clients/1/chat
    {
        "query": "What are the Q1 revenue targets?",
        "top_k": 5
    }
    """
    # Verify client exists
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    
    # Get all documents for this client
    all_docs = db.query(Document).filter(Document.client_id == client_id).all()
    
    if not all_docs:
        return ChatResponse(
            query=chat_request.query,
            answer="No documents available for this client yet. Please upload documents first.",
            sources=[],
            documents_searched=0,
            restricted_docs_excluded=0
        )
    
    # Find restricted documents that don't have access grants
    restricted_doc_ids = [
        doc.id for doc in all_docs
        if doc.is_restricted
    ]
    
    # Get documents with access grants
    granted_docs = db.query(AccessGrant).filter(
        AccessGrant.client_id == client_id
    ).all()
    
    granted_doc_ids = [grant.document_id for grant in granted_docs]
    
    # Exclude restricted docs without grants
    excluded_doc_ids = [
        doc_id for doc_id in restricted_doc_ids
        if doc_id not in granted_doc_ids
    ]
    
    # Search documents
    search_results = search_documents(
        client_id=client_id,
        query=chat_request.query,
        top_k=chat_request.top_k,
        excluded_doc_ids=excluded_doc_ids
    )
    
    if not search_results:
        return ChatResponse(
            query=chat_request.query,
            answer="I couldn't find relevant information in the available documents to answer your question.",
            sources=[],
            documents_searched=len(all_docs) - len(excluded_doc_ids),
            restricted_docs_excluded=len(excluded_doc_ids)
        )
    
    # Generate natural language answer using Llama
    answer = generate_answer(
        query=chat_request.query,
        context_chunks=search_results
    )
    
    # Log query activity
    log_activity(
        db=db,
        activity_type=models.ActivityType.RAG_QUERY,
        client_id=client_id,
        resource_type="query",
        extra_data={
            "query": chat_request.query,
            "results_count": len(search_results),
            "top_k": chat_request.top_k
        }
    )
    increment_query_count(db, client_id)
    
    # Format sources
    sources = [
        {
            "document_id": result['document_id'],
            "title": result['title'],
            "excerpt": result['text'][:200] + "..." if len(result['text']) > 200 else result['text']
        }
        for result in search_results
    ]
    
    return ChatResponse(
        query=chat_request.query,
        answer=answer,
        sources=sources,
        documents_searched=len(all_docs) - len(excluded_doc_ids),
        restricted_docs_excluded=len(excluded_doc_ids)
    )
