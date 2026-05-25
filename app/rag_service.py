import chromadb
from chromadb.config import Settings
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pathlib import Path
import PyPDF2
import docx
from typing import List, Dict, Any


# Initialize embeddings model (runs locally, free)
embeddings_model = HuggingFaceEmbeddings(
    model_name="sentence-transformers/all-MiniLM-L6-v2",
    model_kwargs={'device': 'cpu'}
)

# Path to ChromaDB storage
CHROMA_PATH = Path(__file__).parent.parent / "storage" / "chromadb"
CHROMA_PATH.mkdir(parents=True, exist_ok=True)

# Initialize ChromaDB client
chroma_client = chromadb.PersistentClient(
    path=str(CHROMA_PATH),
    settings=Settings(anonymized_telemetry=False)
)


def extract_text_from_file(file_path: str) -> str:
    """
    Extract text from various file types
    Supports: .txt, .pdf, .docx
    """
    file_path = Path(file_path)
    extension = file_path.suffix.lower()
    
    try:
        if extension == '.txt':
            return file_path.read_text(encoding='utf-8')
        
        elif extension == '.pdf':
            text = ""
            with open(file_path, 'rb') as file:
                pdf_reader = PyPDF2.PdfReader(file)
                for page in pdf_reader.pages:
                    text += page.extract_text() + "\n"
            return text
        
        elif extension == '.docx':
            doc = docx.Document(file_path)
            return "\n".join([paragraph.text for paragraph in doc.paragraphs])
        
        else:
            return ""
    
    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
        return ""


def chunk_text(text: str, chunk_size: int = 500, chunk_overlap: int = 50) -> List[str]:
    """
    Split text into smaller chunks for better embedding
    """
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        length_function=len,
    )
    chunks = text_splitter.split_text(text)
    return chunks


def index_document(
    document_id: int,
    client_id: int,
    file_path: str,
    title: str
) -> int:
    """
    Index a document into the vector database
    Returns number of chunks created
    """
    # Extract text from document
    text = extract_text_from_file(file_path)
    
    if not text.strip():
        raise ValueError(f"No text extracted from {file_path}")
    
    # Split into chunks
    chunks = chunk_text(text)
    
    # Create collection name (one per client for scoping)
    collection_name = f"client_{client_id}"
    
    # Get or create collection
    collection = chroma_client.get_or_create_collection(
        name=collection_name,
        metadata={"client_id": client_id}
    )
    
    # Prepare metadata for each chunk
    metadatas = [
        {
            "document_id": document_id,
            "client_id": client_id,
            "title": title,
            "chunk_index": i
        }
        for i in range(len(chunks))
    ]
    
    # Generate IDs for chunks
    ids = [f"doc_{document_id}_chunk_{i}" for i in range(len(chunks))]
    
    # Embed and store chunks
    embeddings = embeddings_model.embed_documents(chunks)
    
    collection.add(
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas,
        ids=ids
    )
    
    print(f"✅ Indexed document {document_id}: {len(chunks)} chunks")
    return len(chunks)


def search_documents(
    client_id: int,
    query: str,
    top_k: int = 5,
    excluded_doc_ids: List[int] = None
) -> List[Dict[str, Any]]:
    """
    Search for relevant document chunks for a client
    
    Args:
        client_id: The client to search within
        query: The search query
        top_k: Number of results to return
        excluded_doc_ids: Document IDs to exclude (e.g., restricted docs without access)
    
    Returns:
        List of relevant chunks with metadata
    """
    collection_name = f"client_{client_id}"
    
    try:
        collection = chroma_client.get_collection(name=collection_name)
    except Exception:
        # Collection doesn't exist - no documents indexed yet
        return []
    
    # Embed the query
    query_embedding = embeddings_model.embed_query(query)
    
    # Search
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=top_k * 2  # Get extra results for filtering
    )
    
    # Filter out excluded documents
    excluded_doc_ids = excluded_doc_ids or []
    
    filtered_results = []
    for i, metadata in enumerate(results['metadatas'][0]):
        if metadata['document_id'] not in excluded_doc_ids:
            filtered_results.append({
                'text': results['documents'][0][i],
                'document_id': metadata['document_id'],
                'title': metadata['title'],
                'distance': results['distances'][0][i] if 'distances' in results else None
            })
        
        if len(filtered_results) >= top_k:
            break
    
    return filtered_results


def delete_document_from_index(document_id: int, client_id: int):
    """
    Remove a document from the vector database
    """
    collection_name = f"client_{client_id}"
    
    try:
        collection = chroma_client.get_collection(name=collection_name)
        
        # Delete all chunks for this document
        collection.delete(
            where={"document_id": document_id}
        )
        print(f"✅ Deleted document {document_id} from index")
    
    except Exception as e:
        print(f"Error deleting document {document_id}: {e}")
