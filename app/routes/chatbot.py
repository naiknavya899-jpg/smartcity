from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import User
from app.schemas import ChatbotRequest, ChatbotResponse
from app.services.chatbot import ChatbotUnavailableError, reply_to_user

router = APIRouter(prefix="/api/chatbot", tags=["chatbot"])


@router.post("/message", response_model=ChatbotResponse)
def send_chat_message(
    payload: ChatbotRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "citizen":
        raise HTTPException(status_code=403, detail="Urban Eye Assistant is only available to citizen accounts.")
    try:
        return reply_to_user(
            payload.message,
            [turn.model_dump() for turn in payload.history],
            current_user.id,
            db,
        )
    except ChatbotUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
