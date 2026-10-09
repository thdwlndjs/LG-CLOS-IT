from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.schemas.errors import Error, ErrorEnvelope


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


def error_response(request: Request, status: int, code: str, message: str) -> JSONResponse:
    envelope = ErrorEnvelope(error=Error(
        code=code, message=message, request_id=getattr(request.state, "request_id", "unknown")
    ))
    headers = {"X-Request-ID": envelope.error.request_id}
    if status == 401:
        headers["WWW-Authenticate"] = "Bearer"
    if status == 429:
        headers["Retry-After"] = "60"
    return JSONResponse(envelope.model_dump(exclude_none=True), status_code=status, headers=headers)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError):
        return error_response(request, exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(request: Request, exc: RequestValidationError):
        # Do not reflect submitted secrets, personal data or raw validator exceptions.
        return error_response(request, 422, "VALIDATION_ERROR", "Request validation failed")

    @app.exception_handler(HTTPException)
    async def handle_http(request: Request, exc: HTTPException):
        code = {401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND"}.get(
            exc.status_code, "HTTP_ERROR"
        )
        return error_response(request, exc.status_code, code, "Request could not be processed")

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception):
        return error_response(request, 500, "INTERNAL_ERROR", "An unexpected error occurred")
