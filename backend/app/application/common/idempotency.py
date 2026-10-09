import hashlib
import json
from datetime import timedelta

from app.core.clock import utc_now
from app.core.errors import ApiError


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


async def idempotent(repo, member_id, operation, key, payload, status, action, ttl=86400):
    """Response and mutation commit together; replay never reexecutes the command."""
    digest = hashlib.sha256(canonical(payload).encode()).hexdigest()
    await repo.lock(f"idempotency:{member_id}:{operation}:{key}")
    prior = await repo.one(
        "SELECT * FROM wardrobe.idempotency_key WHERE member_id=:member "
        "AND operation=:operation AND key_value=:key",
        member=member_id,
        operation=operation,
        key=str(key),
    )
    if prior:
        if prior["request_hash"] != digest or prior["expires_at"] <= utc_now():
            raise ApiError(409, "CONFLICT", "Idempotency key changed or expired; use a new key")
        return prior["response_body"]
    body = await action()
    await repo.execute(
        "INSERT INTO wardrobe.idempotency_key "
        "(member_id,operation,key_value,request_hash,response_status,response_body,expires_at) "
        "VALUES (:member,:operation,:key,:hash,:status,CAST(:body AS jsonb),:expires)",
        member=member_id,
        operation=operation,
        key=str(key),
        hash=digest,
        status=status,
        body=canonical(body),
        expires=utc_now() + timedelta(seconds=ttl),
    )
    return body
