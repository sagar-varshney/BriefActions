import ollama
from typing import List, Dict

def generate_answer(query: str, context_chunks: List[Dict[str, str]]) -> str:
    """
    Generate a natural language answer using Llama
    
    Args:
        query: User's question
        context_chunks: Retrieved document chunks with metadata
    
    Returns:
        Natural language answer synthesized from context
    """
    # Format context from retrieved chunks
    context = "\n\n".join([
        f"[From {chunk['title']}]\n{chunk['text']}"
        for chunk in context_chunks
    ])
    
        # Enhanced prompt with better semantic understanding AND focus
    prompt = f"""You are a helpful AI assistant answering questions based on provided company documents.

Context from documents:
{context}

User Question: {query}

Instructions:
- Answer the question using ONLY information from the provided context above
- Use semantic understanding: recognize that terms like "Product Launch", "Launch Date", "Release Date" all refer to launches
- Handle typos and spelling variations intelligently (e.g., "DaantKanti" = "Dant Kanti")
- **CRITICAL: Answer ONLY what is specifically asked. Do not include extra information.**
- If the question asks about a SPECIFIC entity (like "DaantKanti"), provide information ONLY about that entity
- If the question asks about a SPECIFIC topic (like "launch date"), provide ONLY that information - not budgets, targets, or other details
- Only mention multiple items if the question explicitly asks for comparisons or lists (e.g., "all launch dates")
- Be concise: 1-3 sentences maximum unless the question explicitly requires more detail
- If you find the answer, state it clearly and stop - don't elaborate unless asked
- If the context doesn't contain the answer, say "I don't have information about that in the available documents"
- Never repeat the question in your answer
- Do not infer or invent facts not present in the context
- Answers must map to explicit context spans
- Resolve pronouns/entities from context only
- For ambiguous questions, ask for clarification
- For single data outputs, respond using only the value
- Do not show chain-of-thought reasoning
- Do not explain the answer unless asked
- Surface conflicts instead of resolving them silently
- If outside-context knowledge is required, refuse
Answer:"""

    
    try:
        # Call Ollama to generate answer
        response = ollama.generate(
            model='llama3.2:3b',
            prompt=prompt,
            options={
                'temperature': 0.3,  # Lower = more focused and factual
                'top_p': 0.9,
                'num_predict': 600  # Increased from 500 for more thorough answers
            }
        )
        
        return response['response'].strip()
    
    except Exception as e:
        print(f"❌ Error generating answer with Llama: {e}")
        # Fallback to raw context if LLM fails
        return f"Based on the available documents, here's what I found:\n\n{context}"
