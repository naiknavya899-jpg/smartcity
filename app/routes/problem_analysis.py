from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.models import User
from app.schemas import ProblemAnalysisRequest, ProblemAnalysisResult
from app.services.problem_analysis import AIConfigurationError, AIProviderError, analyze_problem_text

router = APIRouter(prefix="/api/problem-analysis", tags=["problem-analysis"])


@router.post("/analyze", response_model=ProblemAnalysisResult)
def analyze_input(
    payload: ProblemAnalysisRequest,
    _: User = Depends(get_current_user),
):
    try:
        return analyze_problem_text(payload.input_text)
    except AIConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except AIProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
