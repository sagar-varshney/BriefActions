# RAG Client Center

A backend-first productivity and client-document management system built with **FastAPI**, **ChromaDB**, **LangChain**, **Sentence Transformers**, and **Ollama/Llama 3.2**. The project provides a workspace-based Retrieval-Augmented Generation (RAG) backend where users can upload documents, index them into a vector database, query them through a client-scoped chat endpoint, and receive answers grounded in uploaded documents.

> Current status: the backend is functional. The final UI is being developed separately, while this repository contains the working RAG API backend and a standard development interface through FastAPI Swagger docs.

---

## Features

- **Client/workspace management**
  - Create and manage separate client workspaces.
  - Keep documents and RAG searches scoped to a specific client.

- **Document upload and management**
  - Upload documents for individual clients.
  - Track metadata such as title, document type, upload time, and indexing status.
  - Supports text extraction from `.txt`, `.pdf`, and `.docx` files.

- **RAG document indexing**
  - Splits uploaded documents into smaller chunks.
  - Generates embeddings using `sentence-transformers/all-MiniLM-L6-v2`.
  - Stores embeddings in a persistent ChromaDB vector store.

- **Client-scoped semantic search**
  - Searches only within the selected client workspace.
  - Returns the most relevant chunks along with source metadata.

- **LLM-powered grounded answers**
  - Uses Ollama with `llama3.2:3b` to generate answers from retrieved context.
  - Prompting is designed to reduce hallucination by instructing the model to answer only from retrieved documents.

- **Access control for restricted documents**
  - Documents can be marked as restricted.
  - Restricted documents can be excluded from RAG context unless manually unlocked.

- **User authentication and roles**
  - User registration and login.
  - JWT-based authentication.
  - Password hashing using Passlib.
  - Role-based workspace membership model: owner, admin, editor, viewer.

- **Analytics and activity tracking**
  - Tracks document uploads, indexing, deletions, RAG queries, user logins, and access grants.
  - Provides workspace analytics such as storage usage, document count, query count, upload count, login count, and recent activities.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI |
| Database | SQLite + SQLAlchemy |
| Vector Database | ChromaDB |
| RAG Framework | LangChain |
| Embeddings | Sentence Transformers (`all-MiniLM-L6-v2`) |
| LLM Runtime | Ollama |
| LLM Model | Llama 3.2 3B |
| Document Parsing | PyPDF2, python-docx |
| Authentication | JWT, Passlib |
| Server | Uvicorn |

---

## Project Structure

```text
rag-client-center/
└── backend/
    ├── app/
    │   ├── main.py                 # FastAPI app and main API routes
    │   ├── database.py             # SQLAlchemy database setup
    │   ├── models.py               # Database models
    │   ├── schemas.py              # Pydantic request/response schemas
    │   ├── auth.py                 # JWT and password hashing logic
    │   ├── rag_service.py          # Text extraction, chunking, embeddings, vector search
    │   ├── llm_service.py          # Ollama/Llama answer generation
    │   ├── analytics.py            # Activity logging and usage metrics
    │   └── routers/
    │       ├── auth.py             # Authentication routes
    │       └── analytics_router.py # Analytics routes
    ├── requirements.txt
    └── storage/                    # Runtime storage, ignored in Git
```

---

## How It Works

1. A client/workspace is created.
2. Documents are uploaded under that client.
3. Documents are indexed into ChromaDB.
4. A user asks a question through the client chat endpoint.
5. The backend embeds the query and retrieves the most relevant document chunks.
6. Retrieved chunks are passed to the local LLM through Ollama.
7. The API returns a grounded answer with source metadata.

---

## API Overview

### Health Check

```http
GET /health
```

Returns the API status.

### Client Management

```http
POST /clients
GET /clients
GET /clients/{client_id}
```

Create and retrieve client workspaces.

### Document Management

```http
POST /clients/{client_id}/documents
GET /clients/{client_id}/documents
GET /documents/{document_id}
```

Upload and view documents for a client.

### Document Indexing

```http
POST /documents/{document_id}/index
DELETE /documents/{document_id}/index
```

Index documents into the vector database or remove them from the index.

### RAG Chat

```http
POST /clients/{client_id}/chat
```

Example request:

```json
{
  "query": "What are the key action items from this document?",
  "top_k": 5
}
```

Example response:

```json
{
  "query": "What are the key action items from this document?",
  "answer": "The key action items are...",
  "sources": [
    {
      "document_id": 1,
      "title": "sample_file.txt",
      "text": "Relevant retrieved chunk..."
    }
  ],
  "documents_searched": 3,
  "restricted_docs_excluded": 0
}
```

### Authentication

```http
POST /auth/register
POST /auth/login
GET /auth/me
GET /auth/me/workspaces
```

Provides user registration, login, JWT authentication, and workspace membership retrieval.

### Analytics

```http
GET /analytics/clients/{client_id}/overview
GET /analytics/clients/{client_id}/activity-log
GET /analytics/clients/{client_id}/stats/storage
GET /analytics/clients/{client_id}/stats/queries
GET /analytics/clients/{client_id}/stats/users
```

Provides workspace-level analytics and usage statistics.

---

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git
cd YOUR_REPOSITORY_NAME/backend
```

### 2. Create and activate a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Install and run Ollama

Install Ollama from the official website, then pull the model used by this project:

```bash
ollama pull llama3.2:3b
```

Make sure Ollama is running before using the chat endpoint.

### 5. Run the backend server

```bash
uvicorn app.main:app --reload
```

The API will run at:

```text
http://127.0.0.1:8000
```

Swagger API documentation is available at:

```text
http://127.0.0.1:8000/docs
```

---

## Recommended Development Flow

1. Start the backend:

```bash
uvicorn app.main:app --reload
```

2. Open Swagger docs:

```text
http://127.0.0.1:8000/docs
```

3. Create a client using `POST /clients`.
4. Upload a document using `POST /clients/{client_id}/documents`.
5. Index the uploaded document using `POST /documents/{document_id}/index`.
6. Ask a question using `POST /clients/{client_id}/chat`.

---

## Example Use Cases

- Internal company knowledge assistant
- Client-specific document Q&A
- Productivity assistant for uploaded reports and notes
- Workspace-level document search and summarization
- Multi-client RAG backend for organizations
- Early prototype for reducing hallucination through context-grounded answers

---

## Security Notes

This project is currently a development prototype. Before deploying to production:

- Move the JWT secret key into an environment variable.
- Do not commit local database files.
- Do not commit uploaded documents.
- Do not commit ChromaDB runtime storage.
- Add stronger role checks to protected endpoints.
- Configure CORS based on the final frontend domain.
- Use a production database such as PostgreSQL.

---

## Files Ignored in Git

The repository should ignore local runtime files such as:

```gitignore
.venv/
__pycache__/
*.pyc
.DS_Store
.env
rag_client_center.db
storage/chromadb/
storage/uploads/
storage/documents/
```

This keeps the GitHub repository clean and prevents large/private local files from being uploaded.

---

## Future Improvements

- Add a polished frontend dashboard.
- Add document preview and citation highlighting.
- Improve role-based authorization across all endpoints.
- Add conversation history per workspace.
- Add support for more document formats.
- Add Docker support for easier setup.
- Add PostgreSQL support for production deployment.
- Add hybrid search using both semantic and keyword retrieval.
- Add evaluation metrics for retrieval quality and answer faithfulness.

---

## Status

Backend prototype is working. Final UI integration is planned separately.
