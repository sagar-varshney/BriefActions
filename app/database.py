from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# SQLite database URL - stored in backend/rag_client_center.db
SQLALCHEMY_DATABASE_URL = "sqlite:///./rag_client_center.db"

# Create database engine
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False}  # Needed for SQLite
)

# Session factory for database operations
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for all database models
Base = declarative_base()


def get_db():
    """
    Dependency function that provides a database session
    Used in FastAPI endpoints
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
