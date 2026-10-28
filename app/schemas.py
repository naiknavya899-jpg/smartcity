from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.services.phone import normalize_indian_mobile


class ProblemAnalysisRequest(BaseModel):
    input_text: str = Field(min_length=1, max_length=20000)

    @field_validator("input_text")
    @classmethod
    def input_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Enter some text to analyze.")
        return value


class ChatbotTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)

    @field_validator("content")
    @classmethod
    def trim_chat_content(cls, value: str) -> str:
        return value.strip()


class ChatbotRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[ChatbotTurn] = Field(default_factory=list, max_length=12)

    @field_validator("message")
    @classmethod
    def trim_chat_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Type a message to continue.")
        return value


class ChatbotResponse(BaseModel):
    reply: str
    source: Literal["ai", "help", "complaints"]
    configuration_required: bool = False
    action_path: Optional[Literal["/report"]] = None


class AnalyzedProblem(BaseModel):
    model_config = {"extra": "forbid"}

    problem_id: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(min_length=1, max_length=2000)
    priority: Literal["High", "Medium", "Low"]
    status: Literal["Pending", "In Progress", "Completed"]
    suggested_solution: str = Field(min_length=1, max_length=2000)
    dependencies: list[str] = Field(max_length=20)
    missing_information: list[str] = Field(max_length=20)
    assumptions: list[str] = Field(max_length=20)


class AnalysisSection(BaseModel):
    model_config = {"extra": "forbid"}

    section_id: str = Field(min_length=1, max_length=20)
    section_name: str = Field(min_length=1, max_length=100)
    section_summary: str = Field(min_length=1, max_length=1000)
    problems: list[AnalyzedProblem] = Field(min_length=1, max_length=30)


class ProblemAnalysisResult(BaseModel):
    model_config = {"extra": "forbid"}

    overall_summary: str = Field(min_length=1, max_length=2000)
    detected_intent: str = Field(min_length=1, max_length=500)
    sections: list[AnalysisSection] = Field(min_length=1, max_length=12)
    execution_plan: list[str] = Field(min_length=1, max_length=30)
    follow_up_questions: list[str] = Field(max_length=20)


class UserRegister(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=6)
    phone_number: Optional[str] = Field(default=None, max_length=20)
    sms_notifications_enabled: bool = False

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value):
        return normalize_indian_mobile(value)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: int
    name: str
    email: str
    role: str
    phone_number: Optional[str] = None
    sms_notifications_enabled: bool = False
    profile_image_path: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserProfileUpdate(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone_number: Optional[str] = Field(default=None, max_length=20)
    sms_notifications_enabled: Optional[bool] = None

    @field_validator("phone_number")
    @classmethod
    def validate_phone_number(cls, value):
        return normalize_indian_mobile(value)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class ComplaintCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10)
    latitude: float
    longitude: float
    address: Optional[str] = None


class ComplaintUpdate(BaseModel):
    status: Optional[Literal["pending", "in_progress", "resolved", "rejected", "confirmed_fault", "field_inspection_required", "more_evidence_required"]] = None
    priority: Optional[Literal["high", "medium", "low"]] = None
    admin_notes: Optional[str] = Field(default=None, max_length=2000)
    assigned_team: Optional[str] = Field(default=None, max_length=120)
    verification_action: Optional[Literal["confirm_fault", "request_inspection", "request_evidence", "reject", "metadata_checked", "visual_assessment", "mark_resolved"]] = None
    event_note: Optional[str] = Field(default=None, max_length=2000)
    @model_validator(mode="after")
    def require_rejection_reason(self):
        action_notes = (self.event_note or self.admin_notes or "").strip()
        required_actions = {"confirm_fault", "request_inspection", "request_evidence", "reject", "visual_assessment", "mark_resolved"}
        if self.verification_action in required_actions and not action_notes:
            raise ValueError("A note or reason is required for this verification action.")
        if self.verification_action == "request_inspection" and not (self.assigned_team and self.assigned_team.strip()):
            raise ValueError("Enter the inspection team or inspector to assign.")
        if (self.status == "rejected" or self.verification_action == "reject") and not action_notes:
            raise ValueError("A rejection reason is required.")
        return self


class StatusHistoryResponse(BaseModel):
    id: int
    status: str
    changed_at: datetime

    model_config = {"from_attributes": True}


class AdminStatusHistoryResponse(StatusHistoryResponse):
    note: Optional[str] = None
    event_type: Optional[str] = None
    actor_user_id: Optional[int] = None
    actor_name: Optional[str] = None

    model_config = {"from_attributes": True}


class ComplaintResponse(BaseModel):
    id: int
    user_id: int
    title: str
    description: str
    category: str
    priority: str
    status: str
    department: str
    image_path: Optional[str]
    image_width: Optional[int] = None
    image_height: Optional[int] = None
    video_path: Optional[str] = None
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    video_duration_seconds: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str]
    ai_confidence: Optional[float]
    created_at: datetime
    updated_at: datetime
    status_history: list[StatusHistoryResponse] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class AdminComplaintResponse(ComplaintResponse):
    admin_notes: Optional[str] = None
    assigned_team: Optional[str] = None
    photo_source: Optional[str] = None
    photo_datetime_original: Optional[str] = None
    photo_create_date: Optional[str] = None
    photo_gps_latitude: Optional[float] = None
    photo_gps_longitude: Optional[float] = None
    photo_make: Optional[str] = None
    photo_model: Optional[str] = None
    device_gps_latitude: Optional[float] = None
    device_gps_longitude: Optional[float] = None
    status_history: list[AdminStatusHistoryResponse] = Field(default_factory=list)


class AIAnalysisResult(BaseModel):
    category: str
    priority: str
    department: str
    confidence: float
    nlp_keywords: list[str]


class HotspotPoint(BaseModel):
    latitude: float
    longitude: float
    count: int
    dominant_category: str


class AnalyticsSummary(BaseModel):
    total_complaints: int
    by_status: dict[str, int]
    by_category: dict[str, int]
    by_priority: dict[str, int]
    by_department: dict[str, int]
    hotspots: list[HotspotPoint]
    gee_available: bool











